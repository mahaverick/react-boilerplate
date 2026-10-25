/**
 * @file Razorpay Checkout in the browser: loading its script on demand and
 * opening it for a checkout session the API started. The script is external
 * and served unversioned, so it carries no `integrity` hash; the CSP pins its
 * host instead.
 */
import type { CheckoutConfirm, CheckoutSession } from '@/types/billing.types'

/** Razorpay's script. Unversioned: Razorpay changes it without notice. */
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** How long the script may take to load before checkout gives up on it. */
const SCRIPT_TIMEOUT_MS = 15_000

/** What a failed payment reports on `payment.failed`. */
interface RazorpayPaymentFailure {
  error: { description?: string }
}

/** The Checkout options this app passes. */
export interface RazorpayOptions {
  key: string
  subscription_id: string
  name: string
  prefill: { name: string; email: string }
  /** `1` turns Checkout into a card change on the subscription; absent otherwise. */
  subscription_card_change?: 1
  handler: (response: CheckoutConfirm) => void
  modal: { ondismiss: () => void }
  theme?: { color: string }
}

/** A Checkout instance: the modal and its events. */
interface RazorpayInstance {
  open(): void
  close(): void
  on(event: 'payment.failed', listener: (response: RazorpayPaymentFailure) => void): void
}

/** `window.Razorpay`, which the script defines. */
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance

declare global {
  /** The global Razorpay's script adds. */
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

/** The script did not load: blocked, offline, or slower than 15 seconds. */
export class CheckoutScriptError extends Error {
  /** Names the failure. */
  constructor() {
    super('Razorpay Checkout did not load.')
    this.name = 'CheckoutScriptError'
  }
}

/** Razorpay refused the payment; `description` is its reason, for the person paying, or empty when it gave none. */
export class CheckoutPaymentError extends Error {
  /** Razorpay's reason, such as "Your card was declined". */
  readonly description: string

  /** Keeps Razorpay's reason. */
  constructor(description: string) {
    super(`Payment failed: ${description}`)
    this.name = 'CheckoutPaymentError'
    this.description = description
  }
}

/** The load in flight, shared by every caller until it settles. */
let loading: Promise<RazorpayConstructor> | null = null

/**
 * Razorpay's constructor, injecting its script the first time. Concurrent
 * calls share one script. A failed load removes its tag, so the next call
 * tries again.
 * @returns `window.Razorpay` once the script has defined it.
 * @throws {CheckoutScriptError} When the script errors, loads without defining
 *   Razorpay, or takes longer than 15 seconds.
 */
export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading
  const attempt = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    /** Settles once, clears the timer, and drops a failed tag. */
    const settle = (constructor: RazorpayConstructor | undefined) => {
      clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (constructor) {
        resolve(constructor)
        return
      }
      script.remove()
      reject(new CheckoutScriptError())
    }
    /** The script ran: it should have defined `window.Razorpay`. */
    const onLoad = () => settle(window.Razorpay)
    /** The script was blocked or failed to download. */
    const onError = () => settle(undefined)
    const timer = setTimeout(onError, SCRIPT_TIMEOUT_MS)
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.append(script)
  })
  loading = attempt
  /** Lets the next call start afresh once this load settles. */
  const clear = () => {
    loading = null
  }
  attempt.then(clear, clear)
  return attempt
}

/**
 * The page's `--primary` token as `#rrggbb`, which Razorpay's `theme.color`
 * takes. The token is an `oklch()` value, so a 1-pixel canvas converts it.
 * @returns The colour, or `undefined` when the page has no token or no canvas.
 */
function primaryColor(): string | undefined {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  if (token === '') return undefined
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.fillStyle = token
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Opens Razorpay Checkout for a session the API started. A failed payment
 * closes the modal, so the page and the modal agree that this attempt ended.
 * @param session - The API's checkout session.
 * @param appName - The name Checkout shows at its top.
 * @returns Checkout's answer to hand to the confirm call, or `'dismissed'`
 *   when the modal closed without a payment.
 * @throws {CheckoutScriptError} When the script does not load.
 * @throws {CheckoutPaymentError} When Razorpay refuses the payment.
 */
export async function openRazorpayCheckout(
  session: CheckoutSession,
  appName: string
): Promise<CheckoutConfirm | 'dismissed'> {
  const Razorpay = await loadRazorpay()
  return new Promise((resolve, reject) => {
    let settled = false
    /** Runs `outcome` only for the first of the handler, the dismissal and the failure. */
    const once = (outcome: () => void) => {
      if (settled) return
      settled = true
      outcome()
    }
    const color = primaryColor()
    const checkout = new Razorpay({
      key: session.keyId,
      subscription_id: session.subscriptionId,
      name: appName,
      prefill: session.prefill,
      ...(session.purpose === 'card_change' ? { subscription_card_change: 1 as const } : {}),
      handler: (response) => once(() => resolve(response)),
      modal: { ondismiss: () => once(() => resolve('dismissed')) },
      ...(color === undefined ? {} : { theme: { color } }),
    })
    checkout.on('payment.failed', (response) => {
      once(() => {
        checkout.close()
        reject(new CheckoutPaymentError(response.error.description ?? ''))
      })
    })
    checkout.open()
  })
}
