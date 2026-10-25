import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '@/constants/app'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import {
  CheckoutPaymentError,
  CheckoutScriptError,
  loadRazorpay,
  openRazorpayCheckout,
} from '@/lib/razorpay-checkout'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import {
  billingKeys,
  invalidateBilling,
  tenantBillingQueryOptions,
  useConfirmCheckout,
  useStartCheckout,
  useSwitchInterval,
  useUpdateCard,
} from '@/queries/billing.queries'
import { tenantSettingsQueryOptions } from '@/queries/tenant-forms.queries'
import { READ_ONLY_MODE } from '@/types/api.types'
import type { BillingInterval, CheckoutSession, TenantBilling } from '@/types/billing.types'

/** What the owner asked for: Paid (or Paid again), the other interval, or a new card. */
export type CheckoutKind =
  | { purpose: 'upgrade' | 'switch'; interval: BillingInterval }
  | { purpose: 'card_change' }

/** Where a checkout is, from the click to the confirmed answer. */
export type CheckoutStatus =
  | 'idle'
  | 'starting'
  | 'open'
  | 'confirming'
  | 'waiting'
  | 'done'
  | 'error'

/**
 * What tells the flow the change took: the workspace became `active` (an
 * upgrade from Free or the trial), a next subscription is set (a switch, or
 * Paid again while cancelling), or the confirm answered (a card change).
 */
type Goal = 'active' | 'next_subscription' | 'confirmed'

/** A checkout the API has started, and how the flow knows it took. */
interface Attempt {
  session: CheckoutSession
  goal: Goal
}

/** The flow's state as the page reads it. */
interface FlowState {
  status: CheckoutStatus
  message: string | null
}

/** How often the flow rereads billing after a confirm that did not finish it. */
const POLL_INTERVAL_MS = 2_000

/** How long the flow rereads billing before it hands over to the page. */
const POLL_LIMIT_MS = 30_000

const WAITING_MESSAGE = 'Payment received. We’re confirming it. This page updates when it’s done.'

const SCRIPT_MESSAGE = 'We couldn’t open the payment window. Check your connection and try again.'

/** The interval as the switch toast says it. */
const INTERVAL_ADJECTIVE: Record<BillingInterval, string> = { month: 'monthly', year: 'yearly' }

/**
 * Whether a billing view shows the change took.
 * @param goal - What the flow waits for.
 * @param billing - The view to check.
 */
function reached(goal: Goal, billing: TenantBilling): boolean {
  if (goal === 'active') return billing.state === 'active'
  if (goal === 'next_subscription') return billing.nextSwitch !== null
  return true
}

/**
 * What a confirm failure means: a network failure, a 5xx or read-only
 * maintenance leave the payment to the webhook, so the flow waits; any other
 * refusal is the checkout's fault and ends it.
 * @param error - The confirm's rejection.
 */
function leavesItToTheWebhook(error: unknown): boolean {
  const status = statusFrom(error)
  return status === undefined || status >= 500 || codeFrom(error) === READ_ONLY_MODE
}

/**
 * The failed-payment line, with Razorpay's reason when it gave one.
 * @param description - Razorpay's `error.description`, possibly empty.
 */
function paymentFailedMessage(description: string): string {
  // Razorpay's reasons usually end in a full stop; the sentence adds its own.
  const reason = description.trim().replace(/\.+$/, '')
  return reason === ''
    ? 'Your payment didn’t go through. Try again or use another card.'
    : `Your payment didn’t go through: ${reason}. Try again or use another card.`
}

/**
 * The tenant's time zone, as the server dates its billing messages, or UTC
 * when the settings cannot be read.
 * @param queryClient - The app's query client, which may hold the settings already.
 * @param slug - The tenant.
 */
async function billingTimeZone(queryClient: QueryClient, slug: string): Promise<string> {
  return queryClient.ensureQueryData({ ...tenantSettingsQueryOptions(slug), retry: false }).then(
    (settings) => settings.timezone,
    () => 'UTC'
  )
}

/**
 * The success toast for a finished checkout.
 * @param attempt - The checkout and what finished it.
 * @param billing - The billing view that showed it finished.
 * @param timeZone - The tenant's time zone, for the dates.
 */
function successMessage(attempt: Attempt, billing: TenantBilling, timeZone: string): string {
  const { session, goal } = attempt
  const startsAt = billing.nextSwitch?.startsAt ?? session.startsAt
  if (session.purpose === 'card_change') return 'Card updated.'
  if (session.purpose === 'switch') {
    const interval = INTERVAL_ADJECTIVE[billing.nextSwitch?.interval ?? session.interval]
    return startsAt === null
      ? `Switch to ${interval} billing is scheduled.`
      : `Switch to ${interval} billing starts on ${formatBillingDate(startsAt, timeZone)}.`
  }
  if (goal === 'next_subscription' && startsAt !== null) {
    return `Paid continues after ${formatBillingDate(startsAt, timeZone)}.`
  }
  if (session.startsAt === null) return 'You’re on Paid.'
  return `You’re on Paid. Your first charge of ${formatInr(session.amountMinor)} is on ${formatBillingDate(session.startsAt, timeZone)}.`
}

/**
 * Waits on the clock between billing reads.
 * @param ms - How long.
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Razorpay Checkout from the click to a confirmed change: starts the checkout
 * on the API, opens Checkout, hands its answer to the confirm, and rereads
 * billing every 2 seconds, for up to 30, until the change shows. A confirm the
 * server could not answer, or a change that does not show in time, leaves the
 * flow `waiting`: the webhook still lands, and the flow finishes when the
 * billing view shows it. Refusals set `message` to the server's sentence.
 * @param slug - The tenant.
 * @returns `start`, the `status`, and the line to show for `waiting` and `error`.
 */
export function useCheckoutFlow(slug: string) {
  const queryClient = useQueryClient()
  // `mutateAsync` is stable across renders, unlike the mutation objects, so `start` is too.
  const { mutateAsync: startCheckout } = useStartCheckout(slug)
  const { mutateAsync: switchInterval } = useSwitchInterval(slug)
  const { mutateAsync: updateCard } = useUpdateCard(slug)
  const { mutateAsync: confirmCheckout } = useConfirmCheckout(slug)
  // Watches the view the page fetches, so an SSE refetch can finish a waiting checkout.
  const { data: billing } = useQuery({ ...tenantBillingQueryOptions(slug), enabled: false })
  const [state, setState] = useState<FlowState>({ status: 'idle', message: null })
  const waitingFor = useRef<Attempt | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Ends the flow on a confirmed change: tracks it, then toasts it with dates in the tenant's zone. */
  const finish = useCallback(
    (attempt: Attempt, confirmed: TenantBilling) => {
      waitingFor.current = null
      track('checkout_succeeded', { purpose: attempt.session.purpose })
      setState({ status: 'done', message: null })
      void billingTimeZone(queryClient, slug).then((timeZone) => {
        toast.success(successMessage(attempt, confirmed, timeZone))
      })
    },
    [queryClient, slug]
  )

  /** Hands the attempt over to the webhook: no error tone, and finished later by the billing view. */
  const wait = useCallback((attempt: Attempt) => {
    waitingFor.current = attempt
    track('checkout_failed', { failure_code: 'confirm_failed' })
    setState({ status: 'waiting', message: WAITING_MESSAGE })
  }, [])

  useEffect(() => {
    const attempt = waitingFor.current
    if (state.status !== 'waiting' || attempt === null || !billing) return
    // A card change shows nothing in the view; only its own confirm finishes it.
    if (attempt.goal === 'confirmed' || !reached(attempt.goal, billing)) return
    finish(attempt, billing)
  }, [state.status, billing, finish])

  /**
   * Rereads billing until the attempt's change shows or 30 seconds pass. A
   * failed read is retried on the next tick.
   * @returns The view that shows the change, or `null` when it never did.
   */
  const poll = useCallback(
    async (goal: Goal): Promise<TenantBilling | null> => {
      const deadline = Date.now() + POLL_LIMIT_MS
      while (Date.now() < deadline) {
        await pause(POLL_INTERVAL_MS)
        if (!mounted.current) return null
        try {
          const latest = await queryClient.fetchQuery({
            ...tenantBillingQueryOptions(slug),
            staleTime: 0,
          })
          if (latest && reached(goal, latest)) return latest
        } catch {
          // A failed read is one missed tick; the next one tries again.
        }
      }
      return null
    },
    [queryClient, slug]
  )

  /** Starts the checkout on the API: the start, switch or card-change write. */
  const startSession = useCallback(
    (kind: CheckoutKind): Promise<CheckoutSession> => {
      if (kind.purpose === 'card_change') return updateCard()
      if (kind.purpose === 'switch') return switchInterval({ interval: kind.interval })
      return startCheckout({ interval: kind.interval })
    },
    [startCheckout, switchInterval, updateCard]
  )

  /** Fails the flow with `message`. */
  const failWith = useCallback((message: string) => {
    setState({ status: 'error', message })
  }, [])

  const start = useCallback(
    async (kind: CheckoutKind): Promise<void> => {
      if (running.current) return
      running.current = true
      waitingFor.current = null
      try {
        setState({ status: 'starting', message: null })
        const before = queryClient.getQueryData<TenantBilling | null>(billingKeys.billing(slug))
        let session: CheckoutSession
        try {
          session = await startSession(kind)
        } catch (error) {
          track('checkout_failed', { failure_code: 'start_failed' })
          void invalidateBilling(queryClient, slug)
          failWith(messageFrom(error))
          return
        }
        const goal: Goal =
          session.purpose === 'card_change'
            ? 'confirmed'
            : session.purpose === 'switch' || before?.state === 'active'
              ? 'next_subscription'
              : 'active'
        const attempt: Attempt = { session, goal }

        let answer: Awaited<ReturnType<typeof openRazorpayCheckout>>
        try {
          await loadRazorpay()
          track('checkout_opened', { interval: session.interval, purpose: session.purpose })
          setState({ status: 'open', message: null })
          answer = await openRazorpayCheckout(session, APP_NAME, () => {
            track('checkout_failed', { failure_code: 'payment_failed' })
          })
        } catch (error) {
          if (error instanceof CheckoutPaymentError) {
            failWith(paymentFailedMessage(error.description))
            return
          }
          if (!(error instanceof CheckoutScriptError)) throw error
          track('checkout_failed', { failure_code: 'script_blocked' })
          failWith(SCRIPT_MESSAGE)
          return
        }
        if (answer === 'dismissed') {
          track('checkout_dismissed', { purpose: session.purpose })
          setState({ status: 'idle', message: null })
          return
        }

        setState({ status: 'confirming', message: null })
        let confirmed: TenantBilling
        try {
          confirmed = await confirmCheckout(answer)
        } catch (error) {
          // Not an HTTP failure, so not the payment's: the outer catch ends the flow in `error`.
          if (!isAxiosError(error)) throw error
          if (leavesItToTheWebhook(error)) {
            wait(attempt)
            return
          }
          track('checkout_failed', { failure_code: 'confirm_failed' })
          void invalidateBilling(queryClient, slug)
          failWith(messageFrom(error))
          return
        }
        if (reached(goal, confirmed)) {
          finish(attempt, confirmed)
          return
        }
        const latest = await poll(goal)
        if (!mounted.current) return
        if (latest) finish(attempt, latest)
        else wait(attempt)
      } catch {
        // Anything else, such as Razorpay's constructor refusing an option: `start` never rejects.
        track('checkout_failed', { failure_code: 'start_failed' })
        failWith(SCRIPT_MESSAGE)
      } finally {
        running.current = false
      }
    },
    [confirmCheckout, failWith, finish, poll, queryClient, slug, startSession, wait]
  )

  return { start, status: state.status, message: state.message }
}
