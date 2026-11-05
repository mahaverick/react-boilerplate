/**
 * @file What the Billing settings page offers in each billing state, as data
 * and booleans. The sentences it shows live in `@/copy/billing`.
 */
import type { TenantBilling } from '@/types/billing.types'

/**
 * Whether a card change now needs Razorpay's texted code: a card payment is
 * due. A UPI pause is lifted in the UPI app, so it shows no hint.
 * @param billing - The billing view.
 */
export function cardChangeNeedsCode(billing: TenantBilling): boolean {
  return billing.state === 'past_due' && billing.pastDue?.paused !== true
}

/**
 * Whether an owner is offered Paid: on Free, in the trial, or while Paid is
 * cancelling with no next subscription set (Paid again from the period's end).
 * @param billing - The billing view.
 */
export function showsPlanChoice(billing: TenantBilling): boolean {
  if (billing.state === 'free' || billing.state === 'trialing') return true
  return billing.state === 'active' && billing.cancelAtPeriodEnd && billing.nextSwitch === null
}

/**
 * Whether a Paid subscription is live: active (cancelling included) or past
 * due (paused included). Only then do the payer and the receipts address
 * describe anything; the view keeps both after a move to Free, and an
 * abandoned checkout in the trial can set them.
 * @param billing - The billing view.
 */
export function hasLiveSubscription(billing: TenantBilling): boolean {
  return billing.state === 'active' || billing.state === 'past_due'
}

/**
 * Whether there is a subscription to put a new card on or to cancel: Paid,
 * active or past due, and not already ending with nothing after it. A
 * scheduled switch cancels the current subscription at its end, so the next
 * one keeps these open.
 * @param billing - The billing view.
 */
export function canChangeSubscription(billing: TenantBilling): boolean {
  if (!hasLiveSubscription(billing)) return false
  return !billing.cancelAtPeriodEnd || billing.nextSwitch !== null
}
