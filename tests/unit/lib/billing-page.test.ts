import { canChangeSubscription, cardChangeNeedsCode, showsPlanChoice } from '@/lib/billing-page'
import { testBilling } from '@/tests/fixtures/billing'
import { describe, expect, it } from '@/tests/support/runner'
import type { PriceView } from '@/types/billing.types'

/** Midnight IST on 3 November: still 2 November in UTC. */
const PERIOD_END = '2026-11-02T18:30:00.000Z'
const PAST = '2026-10-20T09:00:00.000Z'
const MONTHLY: PriceView = {
  id: 'price_month',
  interval: 'month',
  amountMinor: 99_900,
  currency: 'INR',
}

/** An active monthly subscription that renews at `PERIOD_END`. */
function active(overrides: Parameters<typeof testBilling>[0] = {}) {
  return testBilling({
    state: 'active',
    interval: 'month',
    price: MONTHLY,
    trialEndsAt: null,
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  })
}

describe('showsPlanChoice', () => {
  it.each([
    ['free', testBilling({ state: 'free' }), true],
    ['trialing', testBilling(), true],
    ['active', active(), false],
    ['active and cancelling', active({ cancelAtPeriodEnd: true }), true],
    [
      'resubscribed while cancelling',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'month', startsAt: PERIOD_END } }),
      false,
    ],
    ['past due', active({ state: 'past_due' }), false],
  ])('%s → %s', (_case, billing, shown) => {
    expect(showsPlanChoice(billing)).toBe(shown)
  })
})

describe('canChangeSubscription (Update card and Cancel Paid)', () => {
  it.each([
    ['free', testBilling({ state: 'free' }), false],
    ['trialing', testBilling(), false],
    ['active', active(), true],
    ['past due', active({ state: 'past_due' }), true],
    ['active and cancelling', active({ cancelAtPeriodEnd: true }), false],
    [
      'switch scheduled (cancelling, with a next subscription)',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'year', startsAt: PERIOD_END } }),
      true,
    ],
  ])('%s → %s', (_case, billing, shown) => {
    expect(canChangeSubscription(billing)).toBe(shown)
  })
})

describe('cardChangeNeedsCode (the texted-code hint)', () => {
  /** A failed card payment, or a UPI mandate paused by the payer. */
  const pastDue = (paused: boolean) => ({ since: PAST, graceEndsAt: null, paused })
  it.each([
    ['active', active(), false],
    ['past due on a card', active({ state: 'past_due', pastDue: pastDue(false) }), true],
    ['past due with no failure details', active({ state: 'past_due', pastDue: null }), true],
    ['paused in the UPI app', active({ state: 'past_due', pastDue: pastDue(true) }), false],
  ])('%s → %s', (_case, billing, shown) => {
    expect(cardChangeNeedsCode(billing)).toBe(shown)
  })
})
