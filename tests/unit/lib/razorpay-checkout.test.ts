import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  CheckoutPaymentError,
  CheckoutScriptError,
  loadRazorpay,
  openRazorpayCheckout,
  type RazorpayOptions,
} from '@/lib/razorpay-checkout'
import type { CheckoutConfirm, CheckoutSession } from '@/types/billing.types'

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** The tags `loadRazorpay` injected and has not removed. */
function injectedScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)]
}

/** A Razorpay instance the fake constructor made, with what the test needs to drive it. */
interface FakeCheckout {
  options: RazorpayOptions
  opened: boolean
  closed: boolean
  failed?: (response: { error: { description?: string } }) => void
}

/** Every checkout the fake constructor made, oldest first. */
let checkouts: FakeCheckout[] = []

/** A stand-in for Razorpay's constructor: records its options, `open()`, `close()` and the `payment.failed` listener. */
class FakeRazorpay {
  /** The record this instance writes to. */
  private readonly record: FakeCheckout

  /** Records the options. */
  constructor(options: RazorpayOptions) {
    this.record = { options, opened: false, closed: false }
    checkouts.push(this.record)
  }

  /** Marks the modal open. */
  open() {
    this.record.opened = true
  }

  /** Marks the modal closed. */
  close() {
    this.record.closed = true
  }

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

/** A checkout session as `POST /billing/checkout` answers it. */
function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    purpose: 'upgrade',
    keyId: 'rzp_test_key',
    subscriptionId: 'sub_123',
    amountMinor: 99_900,
    currency: 'INR',
    interval: 'month',
    startsAt: null,
    prefill: { name: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  }
}

const PAYLOAD: CheckoutConfirm = {
  razorpay_payment_id: 'pay_1',
  razorpay_subscription_id: 'sub_123',
  razorpay_signature: 'signature',
}

beforeEach(() => {
  checkouts = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.Razorpay
  for (const script of injectedScripts()) script.remove()
  document.documentElement.style.removeProperty('--primary')
})

describe('loadRazorpay', () => {
  it('resolves a constructor already on the page without injecting a script', async () => {
    window.Razorpay = FakeRazorpay
    await expect(loadRazorpay()).resolves.toBe(FakeRazorpay)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('injects the script once, async and without integrity, and resolves when it loads', async () => {
    const first = loadRazorpay()
    const second = loadRazorpay()
    const scripts = injectedScripts()
    expect(scripts).toHaveLength(1)
    const [script] = scripts
    expect(script?.async).toBe(true)
    expect(script?.hasAttribute('integrity')).toBe(false)

    window.Razorpay = FakeRazorpay
    script?.dispatchEvent(new Event('load'))

    await expect(first).resolves.toBe(FakeRazorpay)
    await expect(second).resolves.toBe(FakeRazorpay)
  })

  it('rejects with CheckoutScriptError when the script fails, and injects it again on the next call', async () => {
    const attempt = loadRazorpay()
    injectedScripts()[0]?.dispatchEvent(new Event('error'))

    await expect(attempt).rejects.toBeInstanceOf(CheckoutScriptError)
    expect(injectedScripts()).toHaveLength(0)

    const retry = loadRazorpay()
    expect(injectedScripts()).toHaveLength(1)
    // Settles the retry, so its 15-second timer cannot outlive this test.
    injectedScripts()[0]?.dispatchEvent(new Event('error'))
    await expect(retry).rejects.toBeInstanceOf(CheckoutScriptError)
  })

  it('rejects with CheckoutScriptError when the script loads without defining Razorpay', async () => {
    const attempt = loadRazorpay()
    injectedScripts()[0]?.dispatchEvent(new Event('load'))
    await expect(attempt).rejects.toBeInstanceOf(CheckoutScriptError)
  })

  it('rejects with CheckoutScriptError after 15 seconds without an answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let outcome: unknown = 'pending'
    void loadRazorpay().then(
      () => (outcome = 'resolved'),
      (error: unknown) => (outcome = error)
    )

    await act(() => vi.advanceTimersByTimeAsync(14_999))
    expect(outcome).toBe('pending')

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(outcome).toBeInstanceOf(CheckoutScriptError)
    expect(injectedScripts()).toHaveLength(0)
  })
})

describe('openRazorpayCheckout', () => {
  beforeEach(() => {
    window.Razorpay = FakeRazorpay
  })

  it('opens Checkout with the session’s key, subscription and prefill, and no card-change flag for an upgrade', async () => {
    const result = openRazorpayCheckout(session(), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))

    const { options, opened } = lastCheckout()
    expect(opened).toBe(true)
    expect(options.key).toBe('rzp_test_key')
    expect(options.subscription_id).toBe('sub_123')
    expect(options.name).toBe('Acme App')
    expect(options.prefill).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' })
    expect('subscription_card_change' in options).toBe(false)

    options.handler(PAYLOAD)
    await expect(result).resolves.toEqual(PAYLOAD)
  })

  it('sets subscription_card_change to 1 for a card change', async () => {
    void openRazorpayCheckout(session({ purpose: 'card_change' }), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))
    expect(lastCheckout().options.subscription_card_change).toBe(1)
  })

  it('resolves "dismissed" when the modal closes without paying', async () => {
    const result = openRazorpayCheckout(session(), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))
    lastCheckout().options.modal.ondismiss()
    await expect(result).resolves.toBe('dismissed')
  })

  it('closes the modal and rejects with Razorpay’s description when the payment fails', async () => {
    const result = openRazorpayCheckout(session(), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))
    const checkout = lastCheckout()

    checkout.failed?.({ error: { description: 'Your card was declined' } })
    // The close Razorpay reports back must not turn the failure into a dismissal.
    checkout.options.modal.ondismiss()

    const error = await result.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CheckoutPaymentError)
    expect((error as CheckoutPaymentError).description).toBe('Your card was declined')
    expect(checkout.closed).toBe(true)
  })

  it('leaves the theme out when the page has no --primary token', async () => {
    void openRazorpayCheckout(session(), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))
    expect(lastCheckout().options.theme).toBeUndefined()
  })

  it('colours Checkout with --primary, converted to hex', async () => {
    document.documentElement.style.setProperty('--primary', 'oklch(0.218 0.008 223.9)')
    const filled: string[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      set fillStyle(value: string) {
        filled.push(value)
      },
      fillRect: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray([17, 34, 51, 255]) }),
    } as unknown as CanvasRenderingContext2D)

    void openRazorpayCheckout(session(), 'Acme App')
    await vi.waitFor(() => expect(checkouts).toHaveLength(1))

    expect(filled).toEqual(['oklch(0.218 0.008 223.9)'])
    expect(lastCheckout().options.theme).toEqual({ color: '#112233' })
  })
})
