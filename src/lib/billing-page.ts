/**
 * @file The Billing settings page's wording and what it offers in each billing
 * state, kept out of the components so each rule reads and tests on its own.
 */
import { formatInr, perMonthOfYearly } from '@/lib/billing-format'
import type { BillingInterval, TenantBilling } from '@/types/billing.types'

/** What a line needs besides the billing view. */
export interface BillingLineContext {
  /** The moment the page reads as now. */
  now: Date
  /** Formats a billing date in the tenant's time zone. */
  date: (iso: string) => string
  /** The Paid price for an interval in paise, from `GET /plans`; `null` when there is none. */
  priceFor: (interval: BillingInterval) => number | null
}

/** The interval as an adjective: "monthly", "yearly". */
const INTERVAL_ADJECTIVE: Record<BillingInterval, string> = { month: 'monthly', year: 'yearly' }

/** The other interval. */
const OTHER_INTERVAL: Record<BillingInterval, BillingInterval> = { month: 'year', year: 'month' }

/**
 * Whether the workspace is on Paid but has not been charged yet: it upgraded
 * during its trial, and the first charge is at the trial's end.
 * @param billing - The billing view.
 * @param now - The moment the page reads as now.
 */
function isBeforeFirstCharge(billing: TenantBilling, now: Date): boolean {
  return (
    billing.state === 'active' &&
    billing.trialEndsAt !== null &&
    new Date(billing.trialEndsAt).getTime() > now.getTime()
  )
}

/**
 * "₹999 per month", or `null` when there is no amount.
 * @param amountMinor - The amount in paise.
 * @param interval - How often it charges.
 */
function amountPer(amountMinor: number | null, interval: BillingInterval): string | null {
  return amountMinor === null ? null : `${formatInr(amountMinor)} per ${interval}`
}

/**
 * The active state's line, past the next-subscription and first-charge cases.
 * @param billing - An active billing view with no next subscription.
 * @param date - Formats a billing date.
 */
function activeLine(billing: TenantBilling, date: (iso: string) => string): string {
  const periodEnd = billing.currentPeriodEnd === null ? null : date(billing.currentPeriodEnd)
  if (billing.cancelAtPeriodEnd) {
    return periodEnd === null
      ? 'Paid · Ends soon. You won’t be charged again.'
      : `Paid · Ends ${periodEnd}. You won’t be charged again.`
  }
  const parts = ['Paid']
  const price =
    billing.price === null ? null : amountPer(billing.price.amountMinor, billing.price.interval)
  if (price !== null) parts.push(price)
  if (periodEnd !== null) parts.push(`Renews ${periodEnd}`)
  return parts.join(' · ')
}

/**
 * The overview's one-line state: the plan, what it costs and the next date
 * that matters. A next subscription (a switch, or Paid again while cancelling)
 * reads as Paid continuing, never as "Ends", though the current one is
 * cancelling. The amount is the price this workspace pays, which may be a
 * retired one; a next subscription's comes from the plans.
 * @param billing - The billing view.
 * @param context - The clock, the date format and the plan prices.
 * @returns For example "Paid · ₹999 per month · Renews 2 November 2026".
 */
export function billingStateLine(billing: TenantBilling, context: BillingLineContext): string {
  const { date, now, priceFor } = context
  switch (billing.state) {
    case 'free':
      return 'Free'
    case 'trialing':
      return billing.trialEndsAt === null
        ? 'Paid trial'
        : `Paid trial · Ends ${date(billing.trialEndsAt)}`
    case 'past_due': {
      const pastDue = billing.pastDue
      if (pastDue === null) return 'Paid · Payment failed'
      return pastDue.paused
        ? `Paid · Payments paused on ${date(pastDue.since)}`
        : `Paid · Payment failed on ${date(pastDue.since)}`
    }
    case 'active': {
      const next = billing.nextSwitch
      if (next !== null) {
        const price =
          amountPer(priceFor(next.interval), next.interval) ??
          capitalise(INTERVAL_ADJECTIVE[next.interval])
        return `Paid · ${price} from ${date(next.startsAt)}`
      }
      if (isBeforeFirstCharge(billing, now) && billing.trialEndsAt !== null) {
        const amount = billing.price === null ? '' : ` of ${formatInr(billing.price.amountMinor)}`
        return `Paid · First charge${amount} on ${date(billing.trialEndsAt)}`
      }
      return activeLine(billing, date)
    }
  }
}

/**
 * The word with its first letter in capitals.
 * @param word - A lower-case word.
 */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * An interval's price line on the plan choice. The yearly line adds what it
 * comes to a month and the saving against twelve months: in months when it is
 * a whole number of them, otherwise in rupees, and none when there is none.
 * @param interval - The interval shown.
 * @param monthlyMinor - The monthly price in paise, or `null` when there is none.
 * @param yearlyMinor - The yearly price in paise, or `null` when there is none.
 * @returns For example "₹9,990 per year · ₹833 a month · 2 months free".
 */
export function intervalPriceLine(
  interval: BillingInterval,
  monthlyMinor: number | null,
  yearlyMinor: number | null
): string | null {
  if (interval === 'month') return amountPer(monthlyMinor, 'month')
  if (yearlyMinor === null) return null
  const parts = [`${formatInr(yearlyMinor)} per year`, `${perMonthOfYearly(yearlyMinor)} a month`]
  if (monthlyMinor !== null && monthlyMinor > 0) {
    const saving = 12 * monthlyMinor - yearlyMinor
    if (saving > 0) {
      const months = saving / monthlyMinor
      parts.push(
        Number.isInteger(months)
          ? `${String(months)} ${months === 1 ? 'month' : 'months'} free`
          : `Save ${formatInr(saving)}`
      )
    }
  }
  return parts.join(' · ')
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
 * Whether there is a subscription to put a new card on or to cancel: Paid,
 * active or past due, and not already ending with nothing after it. A
 * scheduled switch cancels the current subscription at its end, so the next
 * one keeps these open.
 * @param billing - The billing view.
 */
export function canChangeSubscription(billing: TenantBilling): boolean {
  if (billing.state !== 'active' && billing.state !== 'past_due') return false
  return !billing.cancelAtPeriodEnd || billing.nextSwitch !== null
}

/** What the switch slot shows: a button for the other interval, or a line. */
type SwitchArea =
  | { kind: 'button'; interval: BillingInterval; label: string }
  | { kind: 'line'; text: string }

/**
 * The interval switch. An active subscription is offered the other interval,
 * except before its first charge, which the API refuses; a scheduled switch
 * says when it starts. A resubscribe on the same interval says nothing here,
 * since the state line already does.
 * @param billing - The billing view.
 * @param context - The clock and the date format.
 * @returns The slot's content, or `null` for nothing.
 */
export function switchArea(
  billing: TenantBilling,
  context: Pick<BillingLineContext, 'now' | 'date'>
): SwitchArea | null {
  if (billing.state !== 'active') return null
  const next = billing.nextSwitch
  if (next !== null) {
    if (next.interval === billing.interval) return null
    return {
      kind: 'line',
      text: `Switches to ${INTERVAL_ADJECTIVE[next.interval]} on ${context.date(next.startsAt)}.`,
    }
  }
  if (billing.cancelAtPeriodEnd || billing.interval === null) return null
  if (isBeforeFirstCharge(billing, context.now) && billing.trialEndsAt !== null) {
    return {
      kind: 'line',
      text: `You can switch after your first charge on ${context.date(billing.trialEndsAt)}.`,
    }
  }
  const interval = OTHER_INTERVAL[billing.interval]
  return { kind: 'button', interval, label: `Switch to ${INTERVAL_ADJECTIVE[interval]}` }
}

/**
 * The cancel dialog's body for what cancelling does now: a failed payment
 * ends Paid at once, a cancel before the first charge returns to the trial,
 * and otherwise Paid lasts to the period's end.
 * @param billing - The billing view the owner is cancelling.
 * @param context - The clock and the date format.
 */
export function cancelBody(
  billing: TenantBilling,
  context: Pick<BillingLineContext, 'now' | 'date'>
): string {
  if (billing.state === 'past_due') {
    return 'Paid ends now and the workspace moves to Free. Nothing is deleted.'
  }
  if (isBeforeFirstCharge(billing, context.now) && billing.trialEndsAt !== null) {
    return `You won’t be charged. Your trial runs until ${context.date(billing.trialEndsAt)}, then the workspace moves to Free.`
  }
  const until =
    billing.currentPeriodEnd === null ? 'the period ends' : context.date(billing.currentPeriodEnd)
  return `You keep Paid until ${until}. Then the workspace moves to Free. Nothing is deleted.`
}

/**
 * The toast after a cancel, read from the state the cancel returned.
 * @param billing - The cancel's answer.
 * @param context - The date format.
 */
export function cancelToast(
  billing: TenantBilling,
  context: Pick<BillingLineContext, 'date'>
): string {
  if (billing.state === 'free') return 'You’re on Free.'
  if (billing.state === 'trialing' && billing.trialEndsAt !== null) {
    return `Paid cancelled. Your trial runs until ${context.date(billing.trialEndsAt)}.`
  }
  return billing.currentPeriodEnd === null
    ? 'Paid cancelled.'
    : `Paid ends on ${context.date(billing.currentPeriodEnd)}.`
}
