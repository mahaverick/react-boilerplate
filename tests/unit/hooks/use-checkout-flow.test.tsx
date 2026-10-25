import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test'
import { useCheckoutFlow } from '@/hooks/use-checkout-flow'
import { apiClient } from '@/http/client'
import { resetSessionForTests } from '@/http/session'
import type { RazorpayOptions } from '@/lib/razorpay-checkout'
import { toast } from '@/lib/toast'
import * as analytics from '@/observability/telemetry'
import { billingKeys } from '@/queries/billing.queries'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, testBilling, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { READ_ONLY_MODE } from '@/types/api.types'
import {
  BILLING_BUSY,
  CHECKOUT_MISMATCH,
  PAYMENT_PROVIDER_UNAVAILABLE,
  SUBSCRIPTION_EXISTS,
} from '@/types/billing.types'
import type { CheckoutConfirm, CheckoutSession, TenantBilling } from '@/types/billing.types'

const BASE = '/api/v1/tenants/acme/billing'

/** Midnight, 2 November 2026, in Asia/Kolkata: "1 November" in UTC. */
const STARTS_AT = '2026-11-01T18:30:00.000Z'

/** What Razorpay hands the success handler, and so the confirm body. */
const PAYLOAD: CheckoutConfirm = {
  razorpay_payment_id: 'pay_1',
  razorpay_subscription_id: 'sub_1',
  razorpay_signature: 'signature',
}

const WAITING = 'Payment received. We’re confirming it. This page updates when it’s done.'

/** A Razorpay instance the fake constructor made, with what the test needs to drive it. */
interface FakeCheckout {
  options: RazorpayOptions
  failed?: (response: { error: { description?: string } }) => void
}

/** Every checkout the fake constructor made, oldest first. */
let checkouts: FakeCheckout[] = []

/** A stand-in for Razorpay's constructor: records its options and the `payment.failed` listener. */
class FakeRazorpay {
  /** The record this instance writes to. */
  private readonly record: FakeCheckout

  /** Records the options. */
  constructor(options: RazorpayOptions) {
    this.record = { options }
    checkouts.push(this.record)
  }

  /** Opening needs no record: the constructor already has the options. */
  open() {}

  /** Closing needs no record here; `razorpay-checkout.test.ts` pins it. */
  close() {}

  /** Keeps the `payment.failed` listener. */
  on(event: string, listener: FakeCheckout['failed']) {
    if (event === 'payment.failed') this.record.failed = listener
  }
}

/** The checkout the fake constructor made last. */
function lastCheckout(): FakeCheckout {
  const checkout = checkouts.at(-1)
  if (!checkout) throw new Error('No checkout was opened.')
  return checkout
}

/** A checkout session as the start, switch and card-change writes answer it. */
function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    purpose: 'upgrade',
    keyId: 'rzp_test_key',
    subscriptionId: 'sub_1',
    amountMinor: 99_900,
    currency: 'INR',
    interval: 'month',
    startsAt: null,
    prefill: { name: 'Ada Lovelace', email: testUser.email },
    ...overrides,
  }
}

/** Answers a start write at `path` (`/checkout`, `/interval` or `/payment-method`) and records its bodies. */
function serveStart(path: string, answer: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(`${BASE}${path}`, async ({ request }) => {
      bodies.push(await request.json())
      return answer()
    })
  )
  return bodies
}

/** Answers the confirm with `answer` and records its bodies. */
function serveConfirm(answer: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(`${BASE}/checkout/confirm`, async ({ request }) => {
      bodies.push(await request.json())
      return answer()
    })
  )
  return bodies
}

/** Answers each `GET /billing` with the next view of `views`, repeating the last; returns the call count. */
function serveBilling(...views: TenantBilling[]) {
  const calls = { count: 0 }
  server.use(
    http.get(BASE, () => {
      const view = views[Math.min(calls.count, views.length - 1)]
      calls.count += 1
      return ok(view, 'Billing retrieved.')
    })
  )
  return calls
}

/** Mounts the hook for acme; `before` seeds the billing view the page already holds. */
function renderFlow(before?: TenantBilling) {
  const client = new QueryClient({
    // No garbage-collection timers, so a test can count the flow's own timers.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  if (before) client.setQueryData(billingKeys.billing('acme'), before)
  /** Provides the test's query client. */
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  const view = renderHook(() => useCheckoutFlow('acme'), { wrapper: Wrapper })
  return { ...view, client }
}

/** Under fake timers, lets pending promises and the mocked network settle. */
async function flush() {
  await act(() => vi.advanceTimersByTimeAsync(0))
}

let track: MockInstance<typeof analytics.track>

beforeEach(() => {
  checkouts = []
  window.Razorpay = FakeRazorpay
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
  track = vi.spyOn(analytics, 'track')
  vi.spyOn(toast, 'success')
  server.use(
    // The fresh read an upgrade makes before it starts; a test that counts reads serves its own.
    http.get(BASE, () => ok(testBilling(), 'Billing retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () =>
      ok(
        {
          tenantId: TENANT_ID,
          timezone: 'Asia/Kolkata',
          locale: 'en',
          metadata: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        'Settings retrieved.'
      )
    )
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.Razorpay
  for (const script of document.querySelectorAll('script[src*="checkout.razorpay.com"]')) {
    script.remove()
  }
})

describe('useCheckoutFlow, opening Checkout', () => {
  it('opens Checkout with the session’s key and subscription, and tracks it', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()

    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })

    await waitFor(() => expect(result.current.status).toBe('open'))
    const { options } = lastCheckout()
    expect(options.key).toBe('rzp_test_key')
    expect(options.subscription_id).toBe('sub_1')
    expect('subscription_card_change' in options).toBe(false)
    expect(track).toHaveBeenCalledWith('checkout_opened', { interval: 'month', purpose: 'upgrade' })
  })

  it('posts the chosen interval to the switch write, and opens a card change with the flag set', async () => {
    const switchBodies = serveStart('/interval', () =>
      ok(session({ purpose: 'switch', interval: 'year' }), 'Switch started.', 201)
    )
    const cardBodies = serveStart('/payment-method', () =>
      ok(session({ purpose: 'card_change' }), 'Card change started.', 201)
    )
    const { result } = renderFlow()

    act(() => {
      void result.current.start({ purpose: 'switch', interval: 'year' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    expect(switchBodies).toEqual([{ interval: 'year' }])
    act(() => lastCheckout().options.modal.ondismiss())
    await waitFor(() => expect(result.current.status).toBe('idle'))

    act(() => {
      void result.current.start({ purpose: 'card_change' })
    })
    await waitFor(() => expect(checkouts).toHaveLength(2))
    expect(cardBodies).toEqual([{}])
    expect(lastCheckout().options.subscription_card_change).toBe(1)
  })

  it('goes back to idle and tracks the dismissal when Checkout closes without paying', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.modal.ondismiss())

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.message).toBeNull()
    expect(track).toHaveBeenCalledWith('checkout_dismissed', { purpose: 'upgrade' })
  })
})

describe('useCheckoutFlow, confirming', () => {
  it('confirms with the handler’s payload and finishes at once when the webhook already landed', async () => {
    serveStart('/checkout', () => ok(session({ startsAt: STARTS_AT }), 'Checkout started.', 201))
    const bodies = serveConfirm(() =>
      ok(testBilling({ state: 'active', interval: 'month' }), 'Checkout confirmed.')
    )
    const reads = serveBilling(testBilling())
    const { result } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(bodies).toEqual([PAYLOAD])
    // No poll after the confirm.
    expect(reads.count).toBe(0)
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'upgrade' })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'You’re on Paid. Your first charge of ₹999 is on 2 November 2026.'
      )
    )
  })

  it('says only “You’re on Paid.” for an upgrade that charges at once', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() => ok(testBilling({ state: 'active' }), 'Checkout confirmed.'))
    const { result } = renderFlow(testBilling({ state: 'free', trialEndsAt: null }))
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('You’re on Paid.'))
    expect(result.current.status).toBe('done')
  })

  it('polls billing every 2 seconds until the workspace is active', async () => {
    serveStart('/checkout', () => ok(session({ startsAt: STARTS_AT }), 'Checkout started.', 201))
    serveConfirm(() => ok(testBilling(), 'Checkout confirmed.'))
    const reads = serveBilling(testBilling(), testBilling({ state: 'active' }))
    const { result } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    act(() => lastCheckout().options.handler(PAYLOAD))
    await flush()
    expect(result.current.status).toBe('confirming')
    expect(reads.count).toBe(0)

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(reads.count).toBe(1)
    expect(result.current.status).toBe('confirming')

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(reads.count).toBe(2)
    expect(result.current.status).toBe('done')
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'upgrade' })
  })

  it('waits, with no error tone, when 30 seconds of polling never see the workspace active', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() => ok(testBilling(), 'Checkout confirmed.'))
    const reads = serveBilling(testBilling())
    const { result } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    act(() => lastCheckout().options.handler(PAYLOAD))
    await act(() => vi.advanceTimersByTimeAsync(28_000))
    expect(result.current.status).toBe('confirming')

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(result.current.status).toBe('waiting')
    expect(result.current.message).toBe(WAITING)
    // One read every 2 seconds for 30 seconds.
    expect(reads.count).toBe(15)
    expect(track).toHaveBeenCalledWith('checkout_pending')
    expect(track).not.toHaveBeenCalledWith('checkout_failed', expect.anything())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([
    ['a 500', () => fail('Internal server error.', 500)],
    [
      'the provider being down',
      () => fail('Our payment provider did not answer.', 503, PAYMENT_PROVIDER_UNAVAILABLE),
    ],
    ['read-only maintenance', () => fail('Maintenance.', 503, READ_ONLY_MODE)],
    ['a network failure', () => HttpResponse.error()],
    ['a 429', () => fail('Too many requests. Try again in a minute.', 429, 'RATE_LIMITED')],
    ['a 408', () => fail('The request timed out.', 408)],
    [
      'a 4xx with no message',
      () => HttpResponse.json({ success: false, statusCode: 409 }, { status: 409 }),
    ],
    [
      'a 200 with no data',
      () => HttpResponse.json({ success: true, message: 'OK', statusCode: 200 }),
    ],
  ])('waits with the exact message when the confirm meets %s', async (_case, answer) => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(answer)
    const { result } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('waiting'))
    expect(result.current.message).toBe(WAITING)
    expect(track).toHaveBeenCalledWith('checkout_pending')
    expect(track).not.toHaveBeenCalledWith('checkout_failed', expect.anything())
  })

  it('waits, and never reports a start failure, when the confirm rejects with a non-HTTP error', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const post = apiClient.post.bind(apiClient)
    vi.spyOn(apiClient, 'post').mockImplementation((url, ...rest) =>
      url.endsWith('/checkout/confirm')
        ? Promise.reject(new Error('The signed-in account changed.'))
        : post(url, ...rest)
    )
    const { result } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('waiting'))
    expect(result.current.message).toBe(WAITING)
    expect(track).toHaveBeenCalledWith('checkout_pending')
    expect(track).not.toHaveBeenCalledWith('checkout_failed', expect.anything())
  })

  it('stops polling and leaves no timer when the page unmounts mid-poll', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() => ok(testBilling(), 'Checkout confirmed.'))
    const reads = serveBilling(testBilling())
    const { result, unmount } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    act(() => lastCheckout().options.handler(PAYLOAD))
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(result.current.status).toBe('confirming')
    const readsBefore = reads.count
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    // Short timers of the test harness run out within a second; a pause left behind would still wait.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // The client keeps no garbage-collection timers (see `renderFlow`), so a timer left is the poll's.
    expect(vi.getTimerCount()).toBe(0)
    await act(() => vi.advanceTimersByTimeAsync(4_000))
    expect(reads.count).toBe(readsBefore)
    expect(track).not.toHaveBeenCalledWith('checkout_succeeded', expect.anything())
    expect(track).not.toHaveBeenCalledWith('checkout_failed', expect.anything())
    expect(track).not.toHaveBeenCalledWith('checkout_pending')
  })

  it('finishes a waiting checkout when billing later shows the workspace active', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() => fail('Internal server error.', 500))
    const { result, client } = renderFlow(testBilling())
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    act(() => lastCheckout().options.handler(PAYLOAD))
    await waitFor(() => expect(result.current.status).toBe('waiting'))

    act(() => {
      client.setQueryData(billingKeys.billing('acme'), testBilling({ state: 'active' }))
    })

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.message).toBeNull()
    // One checkout, counted once as pending and once as succeeded, never as failed.
    expect(track).toHaveBeenCalledWith('checkout_pending')
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'upgrade' })
    expect(track).not.toHaveBeenCalledWith('checkout_failed', expect.anything())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('You’re on Paid.'))
  })

  it('shows the server’s message, refetches billing and tracks a failure on a checkout mismatch', async () => {
    const MESSAGE = 'This checkout was replaced. Open Billing to see the current one.'
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() => fail(MESSAGE, 400, CHECKOUT_MISMATCH))
    const { result, client } = renderFlow(testBilling())
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(MESSAGE)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingKeys.billing('acme') })
    expect(track).toHaveBeenCalledWith('checkout_failed', { failure_code: 'confirm_failed' })
    expect(track).not.toHaveBeenCalledWith('checkout_pending')
  })
})

describe('useCheckoutFlow, by purpose', () => {
  it('finishes a switch once the next subscription is set, and names its start', async () => {
    serveStart('/interval', () =>
      ok(session({ purpose: 'switch', interval: 'year', startsAt: STARTS_AT }), 'Started.', 201)
    )
    serveConfirm(() =>
      ok(
        testBilling({
          state: 'active',
          interval: 'month',
          nextSwitch: { interval: 'year', startsAt: STARTS_AT },
        }),
        'Checkout confirmed.'
      )
    )
    const { result } = renderFlow(testBilling({ state: 'active', interval: 'month' }))
    act(() => {
      void result.current.start({ purpose: 'switch', interval: 'year' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'switch' })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Switch to yearly billing starts on 2 November 2026.'
      )
    )
  })

  it('keeps polling a switch while the active workspace has no next subscription yet', async () => {
    serveStart('/interval', () =>
      ok(session({ purpose: 'switch', interval: 'year', startsAt: STARTS_AT }), 'Started.', 201)
    )
    serveConfirm(() => ok(testBilling({ state: 'active' }), 'Checkout confirmed.'))
    const reads = serveBilling(
      testBilling({ state: 'active', nextSwitch: { interval: 'year', startsAt: STARTS_AT } })
    )
    const { result } = renderFlow(testBilling({ state: 'active' }))
    act(() => {
      void result.current.start({ purpose: 'switch', interval: 'year' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    act(() => lastCheckout().options.handler(PAYLOAD))
    await flush()
    expect(result.current.status).toBe('confirming')

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(reads.count).toBe(1)
    expect(result.current.status).toBe('done')
  })

  it('treats an upgrade on an active, cancelling workspace as a resubscribe', async () => {
    serveStart('/checkout', () => ok(session({ startsAt: STARTS_AT }), 'Checkout started.', 201))
    serveConfirm(() =>
      ok(
        testBilling({
          state: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: STARTS_AT,
          nextSwitch: { interval: 'month', startsAt: STARTS_AT },
        }),
        'Checkout confirmed.'
      )
    )
    const cancelling = testBilling({
      state: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: STARTS_AT,
    })
    serveBilling(cancelling)
    const { result } = renderFlow(cancelling)
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Paid continues after 2 November 2026.')
    )
  })

  it('finishes Paid again in the cancel buffer, where the confirm adopts a charge-now checkout', async () => {
    // Past the period's end the API charges now and sets no next subscription.
    const PERIOD_ENDED = '2026-10-21T18:30:00.000Z'
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    serveConfirm(() =>
      ok(
        testBilling({
          state: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: '2026-11-21T18:30:00.000Z',
          nextSwitch: null,
        }),
        'Checkout confirmed.'
      )
    )
    const buffered = testBilling({
      state: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: PERIOD_ENDED,
    })
    const reads = serveBilling(buffered)
    const { result } = renderFlow(buffered)
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(reads.count).toBe(0)
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'upgrade' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('You’re on Paid.'))
  })

  it('keeps polling an upgrade while the workspace still reads as cancelling', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const cancelling = testBilling({
      state: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: STARTS_AT,
    })
    serveConfirm(() => ok(cancelling, 'Checkout confirmed.'))
    const reads = serveBilling(cancelling, testBilling({ state: 'active' }))
    const { result } = renderFlow(cancelling)
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    act(() => lastCheckout().options.handler(PAYLOAD))
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(reads.count).toBe(1)
    expect(result.current.status).toBe('confirming')

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(reads.count).toBe(2)
    expect(result.current.status).toBe('done')
  })

  it('finishes a card change on the confirm’s answer, without polling', async () => {
    serveStart('/payment-method', () => ok(session({ purpose: 'card_change' }), 'Started.', 201))
    serveConfirm(() =>
      ok(testBilling({ state: 'active', interval: 'month' }), 'Checkout confirmed.')
    )
    const reads = serveBilling(testBilling())
    const { result } = renderFlow(testBilling({ state: 'active' }))
    act(() => {
      void result.current.start({ purpose: 'card_change' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(reads.count).toBe(0)
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'card_change' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Card updated.'))
  })

  it.each([
    [
      'Razorpay still retrying',
      { since: STARTS_AT, graceEndsAt: null, paused: false },
      'Card updated. Razorpay will retry the payment with it.',
    ],
    [
      'the subscription halted',
      { since: STARTS_AT, graceEndsAt: '2026-11-08T18:30:00.000Z', paused: false },
      'Card updated. Razorpay restarts your subscription with it.',
    ],
    [
      'payments paused in a UPI app',
      { since: STARTS_AT, graceEndsAt: '2026-11-08T18:30:00.000Z', paused: true },
      'Card updated.',
    ],
  ])('says what happens next to a failed payment, with %s', async (_case, pastDue, message) => {
    serveStart('/payment-method', () => ok(session({ purpose: 'card_change' }), 'Started.', 201))
    serveConfirm(() => ok(testBilling({ state: 'past_due', pastDue }), 'Checkout confirmed.'))
    const { result } = renderFlow(testBilling({ state: 'past_due', pastDue }))
    act(() => {
      void result.current.start({ purpose: 'card_change' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message))
  })

  it('says the card update is being confirmed, not a payment, when a card change waits', async () => {
    serveStart('/payment-method', () => ok(session({ purpose: 'card_change' }), 'Started.', 201))
    serveConfirm(() => fail('Internal server error.', 500))
    const { result } = renderFlow(testBilling({ state: 'past_due' }))
    act(() => {
      void result.current.start({ purpose: 'card_change' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('waiting'))
    expect(result.current.message).toBe('Card received. We’re confirming it with Razorpay.')
  })
})

describe('useCheckoutFlow, failures before the confirm', () => {
  it('says the payment window did not open when the script fails to load', async () => {
    delete window.Razorpay
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    const script = await waitFor(() => {
      const tag = document.querySelector('script[src*="checkout.razorpay.com"]')
      expect(tag).not.toBeNull()
      return tag as HTMLScriptElement
    })

    act(() => {
      script.dispatchEvent(new Event('error'))
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(
      'We couldn’t open the payment window. Check your connection and try again.'
    )
    expect(track).toHaveBeenCalledWith('checkout_failed', { failure_code: 'script_blocked' })
    expect(track).not.toHaveBeenCalledWith('checkout_opened', expect.anything())
  })

  it('keeps Checkout open on a failed payment, tracking each failure once', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().failed?.({ error: { description: 'Bank unavailable' } }))
    act(() => lastCheckout().failed?.({ error: { description: 'Your card was declined.' } }))

    expect(result.current.status).toBe('open')
    expect(result.current.message).toBeNull()
    const failures = (track.mock.calls as unknown[][]).filter(
      (call) =>
        call[0] === 'checkout_failed' &&
        (call[1] as { failure_code: string }).failure_code === 'payment_failed'
    )
    expect(failures).toHaveLength(2)
  })

  it('names Razorpay’s last reason when Checkout closes after a failed payment', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().failed?.({ error: { description: 'Your card was declined.' } }))
    act(() => lastCheckout().options.modal.ondismiss())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(
      'Your payment didn’t go through: Your card was declined. Try again or use another card.'
    )
    expect(track).not.toHaveBeenCalledWith('checkout_dismissed', expect.anything())
  })

  it('confirms a payment that succeeds in the same Checkout after a failed try', async () => {
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const bodies = serveConfirm(() => ok(testBilling({ state: 'active' }), 'Checkout confirmed.'))
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() => lastCheckout().failed?.({ error: { description: 'Your card was declined.' } }))
    act(() => lastCheckout().options.handler(PAYLOAD))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(bodies).toEqual([PAYLOAD])
    expect(track).toHaveBeenCalledWith('checkout_succeeded', { purpose: 'upgrade' })
  })

  it('never rejects: an unexpected throw while opening Checkout ends in an error', async () => {
    window.Razorpay = class {
      /** Throws as Razorpay does on an option it refuses. */
      constructor() {
        throw new TypeError('Invalid option')
      }
    } as unknown as typeof window.Razorpay
    serveStart('/checkout', () => ok(session(), 'Checkout started.', 201))
    const { result } = renderFlow()

    let outcome: Promise<void> = Promise.resolve()
    act(() => {
      outcome = result.current.start({ purpose: 'upgrade', interval: 'month' })
    })

    await expect(outcome).resolves.toBeUndefined()
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(
      'We couldn’t open the payment window. Check your connection and try again.'
    )
    expect(track).toHaveBeenCalledWith('checkout_failed', { failure_code: 'start_failed' })
  })

  it('shows the server’s message, refetches billing and tracks a start failure on SUBSCRIPTION_EXISTS', async () => {
    const MESSAGE = 'We already have your payment. Refresh Billing to see Paid.'
    serveStart('/checkout', () => fail(MESSAGE, 409, SUBSCRIPTION_EXISTS))
    const { result, client } = renderFlow()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(MESSAGE)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingKeys.billing('acme') })
    expect(track).toHaveBeenCalledWith('checkout_failed', { failure_code: 'start_failed' })
    expect(checkouts).toHaveLength(0)
  })

  it('shows the server’s message for a 503 on start', async () => {
    const MESSAGE = 'Your billing is updating right now. Try again in 30 seconds.'
    serveStart('/checkout', () =>
      fail(MESSAGE, 503, BILLING_BUSY, undefined, { 'Retry-After': '30' })
    )
    const { result } = renderFlow()
    act(() => {
      void result.current.start({ purpose: 'upgrade', interval: 'month' })
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.message).toBe(MESSAGE)
    expect(track).toHaveBeenCalledWith('checkout_failed', { failure_code: 'start_failed' })
  })
})

describe('useCheckoutFlow, identity', () => {
  it('keeps `start` the same function across renders', () => {
    const { result, rerender } = renderFlow()
    const first = result.current.start

    rerender()

    expect(result.current.start).toBe(first)
  })
})
