/**
 * @file Which billing banner a tenant page shows, if any. Pure: the clock and
 * the tenant's age come in as arguments.
 */
import type { TenantBilling } from '@/types/billing.types'

/** The billing banners a tenant page can show, one at a time. */
export type BillingBannerKind =
  | 'past_due'
  | 'paused'
  | 'payer_left'
  | 'trial_ending'
  | 'trial_running'
  | 'trial_ended'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A trial this close to its end asks for an upgrade. */
const TRIAL_ENDING_MS = 3 * DAY_MS

/** A new tenant sees no trial prompt in its first day. */
const QUIET_FIRST_MS = 24 * HOUR_MS

/** How long after a trial ends its banner stays up, unless dismissed. */
const TRIAL_ENDED_WINDOW_MS = 14 * DAY_MS

/**
 * The days left in a trial, counting a part day as a day.
 * @param trialEndsAt - The trial's end, as an ISO 8601 string.
 * @param now - The current moment.
 * @returns For example 9 for an end 8 days and 23 hours away.
 */
export function trialDaysLeft(trialEndsAt: string, now: Date): number {
  return Math.ceil((Date.parse(trialEndsAt) - now.getTime()) / DAY_MS)
}

/**
 * Whether the account that pays left the workspace while Paid still runs on
 * its card: active or past due. A payer whose account is gone (`null`) is not
 * one who left.
 * @param billing - The tenant's billing view.
 */
function payerLeft(billing: TenantBilling): boolean {
  if (billing.payer === null || billing.payer.isMember) return false
  return billing.state === 'active' || billing.state === 'past_due'
}

/**
 * The one billing banner to show, by priority: a failed payment (`past_due`,
 * or `paused` in the UPI app); then a payer who left (`payer_left`, while the
 * workspace is active or past due); then a trial ending within 3 days; then a
 * running trial, except in the tenant's first 24 hours; then a trial that
 * ended in the last 14 days and that the viewer has not dismissed.
 * @param billing - The tenant's billing view.
 * @param now - The current moment.
 * @param tenantCreatedAt - When the tenant was created, as an ISO 8601 string.
 * @returns The banner, or `null` when there is nothing to say.
 */
export function pickBillingBanner(
  billing: TenantBilling,
  now: Date,
  tenantCreatedAt: string
): BillingBannerKind | null {
  const nowMs = now.getTime()
  if (billing.state === 'past_due') return billing.pastDue?.paused ? 'paused' : 'past_due'
  if (payerLeft(billing)) return 'payer_left'
  if (billing.state === 'trialing' && billing.trialEndsAt !== null) {
    if (Date.parse(billing.trialEndsAt) - nowMs <= TRIAL_ENDING_MS) return 'trial_ending'
    return nowMs - Date.parse(tenantCreatedAt) > QUIET_FIRST_MS ? 'trial_running' : null
  }
  if (billing.state === 'free' && billing.trialEndsAt !== null) {
    const sinceEnd = nowMs - Date.parse(billing.trialEndsAt)
    const inWindow = sinceEnd >= 0 && sinceEnd <= TRIAL_ENDED_WINDOW_MS
    if (inWindow && !billing.dismissedBanners.includes('trial_ended')) return 'trial_ended'
  }
  return null
}
