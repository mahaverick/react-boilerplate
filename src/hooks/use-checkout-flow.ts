import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '@/constants/app'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import { INTERVAL_ADJECTIVE } from '@/lib/billing-page'
import {
  CheckoutPaymentError,
  CheckoutScriptError,
  loadRazorpay,
  openRazorpayCheckout,
} from '@/lib/razorpay-checkout'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import {
  invalidateBilling,
  tenantBillingQueryOptions,
  useConfirmCheckout,
  useStartCheckout,
  useSwitchInterval,
  useUpdateCard,
} from '@/queries/billing.queries'
import { billingTimeZone } from '@/queries/tenant-forms.queries'
import type { ApiErrorBody } from '@/types/api.types'
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
 * What tells the flow the change took: Paid that no longer ends, or a next
 * subscription after the current one (an upgrade, from Free, the trial or a
 * cancelling Paid); a next subscription (a switch); or the confirm's answer
 * (a card change).
 */
type Goal = 'paid' | 'next_subscription' | 'confirmed'

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

/**
 * The waiting line for a card change, which takes no payment. Nothing in the
 * billing view shows a new card, so it promises no change on the page.
 */
const CARD_WAITING_MESSAGE = 'Card received. We’re confirming it with Razorpay.'

const SCRIPT_MESSAGE = 'We couldn’t open the payment window. Check your connection and try again.'

/**
 * What a billing view says about the subscription, as one comparable string:
 * the state, the plan, the interval, the dates and the payment trouble. A
 * dismissed banner or a new payer does not change it.
 * @param billing - The view, or nothing while it is unread.
 */
function subscriptionKey(billing: TenantBilling | null | undefined): string {
  if (!billing) return ''
  return JSON.stringify([
    billing.state,
    billing.plan.key,
    billing.interval,
    billing.trialEndsAt,
    billing.currentPeriodEnd,
    billing.cancelAtPeriodEnd,
    billing.nextSwitch,
    billing.pastDue,
  ])
}

/**
 * Whether a billing view shows the change took.
 * @param goal - What the flow waits for.
 * @param billing - The view to check.
 */
function reached(goal: Goal, billing: TenantBilling): boolean {
  // Read from the view, not from what the flow saw before: a cancelling Paid past its period end charges now and never sets a next subscription.
  if (goal === 'paid') {
    return billing.nextSwitch !== null || (billing.state === 'active' && !billing.cancelAtPeriodEnd)
  }
  if (goal === 'next_subscription') return billing.nextSwitch !== null
  return true
}

/**
 * What finishes each checkout.
 * @param purpose - The session's purpose.
 */
function goalOf(purpose: CheckoutSession['purpose']): Goal {
  if (purpose === 'card_change') return 'confirmed'
  return purpose === 'switch' ? 'next_subscription' : 'paid'
}

/**
 * Whether a confirm failure is the server refusing this checkout: a 4xx other
 * than 408 and 429 that carries the server's sentence. The payment is taken by
 * then, so anything else (no response, a 5xx, a timeout, a rate limit, a
 * malformed answer, a non-HTTP throw) leaves it to the webhook and the flow waits.
 * @param error - The confirm's rejection.
 */
function refusedByTheServer(error: unknown): boolean {
  if (!isAxiosError(error)) return false
  const status = statusFrom(error)
  if (status === undefined || status < 400 || status >= 500 || status === 408 || status === 429) {
    return false
  }
  const body = error.response?.data as ApiErrorBody | undefined
  return typeof body?.message === 'string' && body.message !== ''
}

/**
 * Razorpay's reason when the person skipped the texted code that saves the
 * card: "Payment failed. Please login." Its classic Checkout, used while a
 * payment is due, will not pay without a saved card.
 */
const CARD_NOT_SAVED = /please log ?in/i

const CARD_NOT_SAVED_MESSAGE =
  'Razorpay didn’t save your card, so nothing was charged. Try again and enter the code Razorpay texts to your phone.'

/**
 * The failed-payment line, with Razorpay's reason when it gave one.
 * @param description - Razorpay's `error.description`, possibly empty.
 */
function paymentFailedMessage(description: string): string {
  if (CARD_NOT_SAVED.test(description)) return CARD_NOT_SAVED_MESSAGE
  // Razorpay's reasons usually end in a full stop; the sentence adds its own.
  const reason = description.trim().replace(/\.+$/, '')
  return reason === ''
    ? 'Your payment didn’t go through. Try again or use another card.'
    : `Your payment didn’t go through: ${reason}. Try again or use another card.`
}

/**
 * The card-change toast, with what happens next while a payment is still due.
 * Razorpay retries a failed payment until it halts the subscription
 * (`graceEndsAt` unset), so the next try uses the new card. A halted one
 * restarts on the new card. A UPI pause is lifted in the UPI app, which a
 * card does not change.
 * @param billing - The view the confirm answered.
 */
function cardChangeMessage(billing: TenantBilling): string {
  const pastDue = billing.pastDue
  if (billing.state !== 'past_due' || pastDue === null || pastDue.paused) return 'Card updated.'
  return pastDue.graceEndsAt === null
    ? 'Card updated. Razorpay will retry the payment with it.'
    : 'Card updated. Razorpay restarts your subscription with it.'
}

/**
 * The success toast for a finished checkout, worded from the view that
 * finished it: a next subscription means Paid continues after the current
 * one; otherwise the upgrade is Paid now, charged now or at the session's start.
 * @param attempt - The checkout.
 * @param billing - The billing view that showed it finished.
 * @param timeZone - The tenant's time zone, for the dates.
 */
function successMessage(attempt: Attempt, billing: TenantBilling, timeZone: string): string {
  const { session } = attempt
  const next = billing.nextSwitch
  if (session.purpose === 'card_change') return cardChangeMessage(billing)
  if (session.purpose === 'switch') {
    const startsAt = next?.startsAt ?? session.startsAt
    const interval = INTERVAL_ADJECTIVE[next?.interval ?? session.interval]
    return startsAt === null
      ? `Switch to ${interval} billing is scheduled.`
      : `Switch to ${interval} billing starts on ${formatBillingDate(startsAt, timeZone)}.`
  }
  if (next !== null) {
    return `Paid continues after ${formatBillingDate(next.startsAt, timeZone)}.`
  }
  if (session.startsAt === null) return 'You’re on Paid.'
  return `You’re on Paid. Your first charge of ${formatInr(session.amountMinor)} is on ${formatBillingDate(session.startsAt, timeZone)}.`
}

/**
 * Razorpay Checkout from the click to a confirmed change: starts the checkout
 * on the API, opens Checkout, hands its answer to the confirm, and rereads
 * billing every 2 seconds, for up to 30, until the change shows. A confirm the
 * server could not answer, or a change that does not show in time, leaves the
 * flow `waiting`: the webhook still lands, and the flow finishes when the
 * billing view shows it. Refusals set `message` to the server's sentence.
 * An error line, or a card change's waiting line, clears itself once the
 * billing view's subscription changes (a cancel, a move to Free, a webhook),
 * and `clear` drops it when another billing action starts.
 * @param slug - The tenant.
 * @returns `start`, `clear`, the `status`, and the line to show for `waiting` and `error`.
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
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null)
  // The subscription the error or card-change waiting line was written against.
  const shownFor = useRef<string | null>(null)

  /** The subscription as the cached billing view says it now. */
  const currentKey = useCallback(
    () => subscriptionKey(queryClient.getQueryData(tenantBillingQueryOptions(slug).queryKey)),
    [queryClient, slug]
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Ends the poll's pause at once, so an unmounted flow leaves no timer behind.
      const paused = pending.current
      pending.current = null
      if (paused) {
        clearTimeout(paused.timer)
        paused.resolve()
      }
    }
  }, [])

  /** Waits on the clock between billing reads; an unmount ends the wait early. */
  const pause = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pending.current = null
          resolve()
        }, ms)
        pending.current = { timer, resolve }
      }),
    []
  )

  /** Ends the flow on a confirmed change: tracks it, then toasts it with dates in the tenant's zone. */
  const finish = useCallback(
    (attempt: Attempt, confirmed: TenantBilling) => {
      waitingFor.current = null
      track('checkout_succeeded', { purpose: attempt.session.purpose })
      setState({ status: 'done', message: null })
      void billingTimeZone(queryClient, slug)
        .then((timeZone) => {
          toast.success(successMessage(attempt, confirmed, timeZone))
        })
        .catch(() => {
          // The change is confirmed and `status` says so; a toast that cannot be worded is dropped.
        })
    },
    [queryClient, slug]
  )

  /**
   * Hands the attempt over to the webhook: no error tone, and finished later
   * by the billing view. Tracked as pending, not failed: the payment is taken,
   * and `finish` tracks the success if the view shows it.
   */
  const wait = useCallback(
    (attempt: Attempt) => {
      waitingFor.current = attempt
      shownFor.current = currentKey()
      track('checkout_pending', { purpose: attempt.session.purpose })
      setState({
        status: 'waiting',
        message: attempt.session.purpose === 'card_change' ? CARD_WAITING_MESSAGE : WAITING_MESSAGE,
      })
    },
    [currentKey]
  )

  /**
   * Drops an error line, or a card change's waiting line: the page has moved
   * on, so the line no longer describes it. A running checkout, and an
   * upgrade or switch waiting on the webhook, keep theirs: that payment is
   * taken, and its wait still finishes it when the view shows the change.
   */
  const clear = useCallback(() => {
    if (running.current) return
    if (state.status === 'waiting' && waitingFor.current?.goal !== 'confirmed') return
    if (state.status !== 'error' && state.status !== 'waiting') return
    waitingFor.current = null
    shownFor.current = null
    setState({ status: 'idle', message: null })
  }, [state.status])

  useEffect(() => {
    if (!billing || shownFor.current === null) return
    if (subscriptionKey(billing) !== shownFor.current) clear()
  }, [billing, clear])

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
      // A read can settle after an unmount; the mounted check keeps it from starting another pause.
      while (mounted.current && Date.now() < deadline) {
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
    [pause, queryClient, slug]
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

  /** Fails the flow with `message`, written against the subscription as it stands. */
  const failWith = useCallback(
    (message: string) => {
      shownFor.current = currentKey()
      setState({ status: 'error', message })
    },
    [currentKey]
  )

  const start = useCallback(
    async (kind: CheckoutKind): Promise<void> => {
      if (running.current) return
      running.current = true
      waitingFor.current = null
      shownFor.current = null
      try {
        setState({ status: 'starting', message: null })
        let session: CheckoutSession
        try {
          session = await startSession(kind)
        } catch (error) {
          track('checkout_failed', { failure_code: 'start_failed' })
          void invalidateBilling(queryClient, slug)
          failWith(messageFrom(error))
          return
        }
        const goal = goalOf(session.purpose)
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

        // The handler fired, so the payment is taken: from here, only a server refusal is an error.
        setState({ status: 'confirming', message: null })
        try {
          let confirmed: TenantBilling
          try {
            confirmed = await confirmCheckout(answer)
          } catch (error) {
            if (!refusedByTheServer(error)) throw error
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
          wait(attempt)
        }
      } catch {
        // A throw before Razorpay's handler, such as its constructor refusing an option: `start` never rejects.
        track('checkout_failed', { failure_code: 'start_failed' })
        failWith(SCRIPT_MESSAGE)
      } finally {
        running.current = false
      }
    },
    [confirmCheckout, failWith, finish, poll, queryClient, slug, startSession, wait]
  )

  return { start, clear, status: state.status, message: state.message }
}
