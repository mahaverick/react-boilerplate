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

/** The line an owner sees in place of every pay button while payments are off. */
export const PAYMENTS_OFF = 'Payments aren’t set up yet.'

/**
 * The line by a card change while a card payment is due. Razorpay then charges
 * the due amount in its classic Checkout, which saves the card only after a
 * code it texts to the phone; skipping the code fails the change.
 */
export const CARD_CODE_HINT =
  'Razorpay texts a code to your phone to save the new card. Enter it to finish.'

/**
 * Whether a card change now needs Razorpay's texted code: a card payment is
 * due. A UPI pause is lifted in the UPI app, so it shows no hint.
 * @param billing - The billing view.
 */
export function cardChangeNeedsCode(billing: TenantBilling): boolean {
  return billing.state === 'past_due' && billing.pastDue?.paused !== true
}

/** The interval as an adjective: "monthly", "yearly". */
export const INTERVAL_ADJECTIVE: Record<BillingInterval, string> = {
  month: 'monthly',
  year: 'yearly',
}

/**
 * How long a cancelled Paid stays on after its period ends, as express's
 * `CANCEL_BUFFER_DAYS` (early card debits, late UPI) before the workspace
 * reads as Free.
 */
const CANCEL_BUFFER_MS = 3 * 24 * 60 * 60 * 1000

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
 * A cancelled period that has ended reads as ended, with the day the
 * workspace moves to Free, never as ending on a past date.
 * @param billing - An active billing view with no next subscription.
 * @param context - The clock and the date format.
 */
function activeLine(
  billing: TenantBilling,
  { date, now }: Pick<BillingLineContext, 'now' | 'date'>
): string {
  const end = billing.currentPeriodEnd
  if (billing.cancelAtPeriodEnd) {
    if (end === null) return 'Paid · Ends soon. You won’t be charged again.'
    const endsAt = new Date(end).getTime()
    if (endsAt > now.getTime()) return `Paid · Ends ${date(end)}. You won’t be charged again.`
    const free = date(new Date(endsAt + CANCEL_BUFFER_MS).toISOString())
    return `Paid · Period ended ${date(end)}. Moves to Free on ${free}.`
  }
  const periodEnd = end === null ? null : date(end)
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
 * @returns For example "Paid · ₹999 per month · Renews 2 November 2026", or
 *   `null` on Free, where the plan's name above says it all.
 */
export function billingStateLine(
  billing: TenantBilling,
  context: BillingLineContext
): string | null {
  const { date, now, priceFor } = context
  switch (billing.state) {
    case 'free':
      return null
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
      return activeLine(billing, { date, now })
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
 * comes to a month and the saving against twelve months (`yearlySaving`),
 * when there is one.
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
  const saving = yearlySaving(monthlyMinor, yearlyMinor)
  if (saving !== null) parts.push(saving)
  return parts.join(' · ')
}

/**
 * What a year costs less than twelve months: in months when it is a whole
 * number of them, otherwise in rupees.
 * @param monthlyMinor - The monthly price in paise, or `null` when there is none.
 * @param yearlyMinor - The yearly price in paise.
 * @returns For example "2 months free" or "Save ₹1,988"; `null` when there is no saving.
 */
export function yearlySaving(monthlyMinor: number | null, yearlyMinor: number): string | null {
  if (monthlyMinor === null || monthlyMinor <= 0) return null
  const saving = 12 * monthlyMinor - yearlyMinor
  if (saving <= 0) return null
  const months = saving / monthlyMinor
  return Number.isInteger(months)
    ? `${String(months)} ${months === 1 ? 'month' : 'months'} free`
    : `Save ${formatInr(saving)}`
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
 * The plan choice's button. While Paid is cancelling and its period has not
 * ended, Paid again starts after it; past the period's end (the cancel
 * buffer) Paid again charges now, so it reads as an upgrade.
 * @param billing - The billing view.
 * @param context - The clock and the date format.
 * @returns For example "Keep Paid after 2 November 2026", or "Upgrade to Paid".
 */
export function upgradeLabel(
  billing: TenantBilling,
  context: Pick<BillingLineContext, 'now' | 'date'>
): string {
  const periodEnd = billing.currentPeriodEnd
  const keeps =
    billing.state === 'active' &&
    billing.cancelAtPeriodEnd &&
    periodEnd !== null &&
    new Date(periodEnd).getTime() > context.now.getTime()
  return keeps ? `Keep Paid after ${context.date(periodEnd)}` : 'Upgrade to Paid'
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
