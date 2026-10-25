import { describe, expect, it } from 'vite-plus/test'
import { formatBillingDate } from '@/lib/billing-format'
import {
  billingStateLine,
  cancelBody,
  cancelToast,
  canChangeSubscription,
  intervalPriceLine,
  showsPlanChoice,
  switchArea,
  upgradeLabel,
  yearlySaving,
} from '@/lib/billing-page'
import { testBilling } from '@/tests/fixtures/billing'
import type { PriceView } from '@/types/billing.types'

const NOW = new Date('2026-10-25T10:00:00.000Z')
/** Midnight IST on 3 November: still 2 November in UTC. */
const PERIOD_END = '2026-11-02T18:30:00.000Z'
const TRIAL_END = '2026-11-05T18:30:00.000Z'
const PAST = '2026-10-20T09:00:00.000Z'
const MONTHLY: PriceView = {
  id: 'price_month',
  interval: 'month',
  amountMinor: 99_900,
  currency: 'INR',
}
const YEARLY: PriceView = {
  id: 'price_year',
  interval: 'year',
  amountMinor: 999_000,
  currency: 'INR',
}

const context = {
  now: NOW,
  date: (iso: string) => formatBillingDate(iso, 'UTC'),
  priceFor: (interval: 'month' | 'year') => (interval === 'month' ? 99_900 : 999_000),
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

describe('billingStateLine in the cancel buffer', () => {
  it('says the period ended and when the workspace moves to Free, not that it ends on a past date', () => {
    expect(
      // A day before NOW, so inside express's 3-day buffer.
      billingStateLine(
        active({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-10-24T09:00:00.000Z' }),
        context
      )
    ).toBe('Paid · Period ended 24 October 2026. Moves to Free on 27 October 2026.')
  })
})

describe('billingStateLine', () => {
  it.each([
    ['trialing', testBilling({ trialEndsAt: TRIAL_END }), 'Paid trial · Ends 5 November 2026'],
    [
      'free',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null }),
      'Free',
    ],
    ['active monthly', active(), 'Paid · ₹999 per month · Renews 2 November 2026'],
    [
      'active yearly',
      active({ interval: 'year', price: YEARLY }),
      'Paid · ₹9,990 per year · Renews 2 November 2026',
    ],
    [
      'active and cancelling',
      active({ cancelAtPeriodEnd: true }),
      'Paid · Ends 2 November 2026. You won’t be charged again.',
    ],
    [
      'past due',
      active({ state: 'past_due', pastDue: { since: PAST, graceEndsAt: null, paused: false } }),
      'Paid · Payment failed on 20 October 2026',
    ],
    [
      'past due with no details',
      active({ state: 'past_due', pastDue: null }),
      'Paid · Payment failed',
    ],
    [
      'paused',
      active({ state: 'past_due', pastDue: { since: PAST, graceEndsAt: null, paused: true } }),
      'Paid · Payments paused on 20 October 2026',
    ],
    [
      'active before the first charge',
      active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }),
      'Paid · First charge of ₹999 on 5 November 2026',
    ],
    [
      'switch scheduled, the current subscription cancelling at its end',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'year', startsAt: PERIOD_END } }),
      'Paid · ₹9,990 per year from 2 November 2026',
    ],
    [
      'resubscribed while cancelling, same interval',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'month', startsAt: PERIOD_END } }),
      'Paid · ₹999 per month from 2 November 2026',
    ],
  ])('reads %s', (_case, billing, line) => {
    expect(billingStateLine(billing, context)).toBe(line)
  })

  it('never says "Ends" while a next subscription is set', () => {
    const billing = active({
      cancelAtPeriodEnd: true,
      nextSwitch: { interval: 'year', startsAt: PERIOD_END },
    })
    expect(billingStateLine(billing, context)).not.toContain('Ends')
  })

  it('dates in the tenant’s zone', () => {
    expect(
      billingStateLine(active(), {
        ...context,
        date: (iso) => formatBillingDate(iso, 'Asia/Kolkata'),
      })
    ).toBe('Paid · ₹999 per month · Renews 3 November 2026')
  })

  it('names the interval without an amount when the next price is unknown', () => {
    const billing = active({ nextSwitch: { interval: 'year', startsAt: PERIOD_END } })
    expect(billingStateLine(billing, { ...context, priceFor: () => null })).toBe(
      'Paid · Yearly from 2 November 2026'
    )
  })
})

describe('intervalPriceLine', () => {
  it('says the monthly price', () => {
    expect(intervalPriceLine('month', 99_900, 999_000)).toBe('₹999 per month')
  })

  it('counts the yearly saving in months when it is a whole number of them', () => {
    expect(intervalPriceLine('year', 99_900, 999_000)).toBe(
      '₹9,990 per year · ₹833 a month · 2 months free'
    )
  })

  it('says one month in the singular', () => {
    expect(intervalPriceLine('year', 100_000, 1_100_000)).toBe(
      '₹11,000 per year · ₹917 a month · 1 month free'
    )
  })

  it('counts the saving in rupees when it is not whole months', () => {
    expect(intervalPriceLine('year', 99_900, 1_000_000)).toBe(
      '₹10,000 per year · ₹833 a month · Save ₹1,988'
    )
  })

  it('claims no saving when the year costs as much as twelve months, or the month is unknown', () => {
    expect(intervalPriceLine('year', 100_000, 1_200_000)).toBe('₹12,000 per year · ₹1,000 a month')
    expect(intervalPriceLine('year', null, 999_000)).toBe('₹9,990 per year · ₹833 a month')
  })
})

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

describe('upgradeLabel', () => {
  it.each([
    ['in the trial', testBilling(), 'Upgrade to Paid'],
    ['on Free', testBilling({ state: 'free' }), 'Upgrade to Paid'],
    [
      'cancelling, before the period ends',
      active({ cancelAtPeriodEnd: true }),
      'Keep Paid after 2 November 2026',
    ],
    // The cancel buffer: still active for 3 days after the period, and Paid again charges now.
    [
      'cancelling, after the period ended',
      active({ cancelAtPeriodEnd: true, currentPeriodEnd: PAST }),
      'Upgrade to Paid',
    ],
    [
      'cancelling with no period end',
      active({ cancelAtPeriodEnd: true, currentPeriodEnd: null }),
      'Upgrade to Paid',
    ],
  ])('%s → %s', (_case, billing, label) => {
    expect(upgradeLabel(billing, context)).toBe(label)
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

describe('switchArea', () => {
  it('offers the other interval on an active subscription', () => {
    expect(switchArea(active(), context)).toEqual({
      kind: 'button',
      interval: 'year',
      label: 'Switch to yearly',
    })
    expect(switchArea(active({ interval: 'year', price: YEARLY }), context)).toEqual({
      kind: 'button',
      interval: 'month',
      label: 'Switch to monthly',
    })
  })

  it('says when switching opens before the first charge', () => {
    expect(
      switchArea(active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }), context)
    ).toEqual({
      kind: 'line',
      text: 'You can switch after your first charge on 5 November 2026.',
    })
  })

  it('names a scheduled switch', () => {
    const billing = active({
      cancelAtPeriodEnd: true,
      nextSwitch: { interval: 'year', startsAt: PERIOD_END },
    })
    expect(switchArea(billing, context)).toEqual({
      kind: 'line',
      text: 'Switches to yearly on 2 November 2026.',
    })
  })

  it.each([
    [
      'a resubscribe on the same interval',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'month', startsAt: PERIOD_END } }),
    ],
    ['a cancelling subscription', active({ cancelAtPeriodEnd: true })],
    ['past due', active({ state: 'past_due' })],
    ['free', testBilling({ state: 'free' })],
  ])('offers nothing for %s', (_case, billing) => {
    expect(switchArea(billing, context)).toBeNull()
  })
})

describe('cancelBody', () => {
  it('keeps Paid to the period’s end by default', () => {
    expect(cancelBody(active(), context)).toBe(
      'You keep Paid until 2 November 2026. Then the workspace moves to Free. Nothing is deleted.'
    )
  })

  it('returns to the trial before the first charge', () => {
    expect(
      cancelBody(active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }), context)
    ).toBe(
      'You won’t be charged. Your trial runs until 5 November 2026, then the workspace moves to Free.'
    )
  })

  it('ends Paid now when a payment failed', () => {
    expect(cancelBody(active({ state: 'past_due' }), context)).toBe(
      'Paid ends now and the workspace moves to Free. Nothing is deleted.'
    )
  })
})

describe('cancelToast', () => {
  it('reads the state the cancel returned', () => {
    expect(cancelToast(testBilling({ state: 'free', trialEndsAt: null }), context)).toBe(
      'You’re on Free.'
    )
    expect(cancelToast(testBilling({ trialEndsAt: TRIAL_END }), context)).toBe(
      'Paid cancelled. Your trial runs until 5 November 2026.'
    )
    expect(cancelToast(active({ cancelAtPeriodEnd: true }), context)).toBe(
      'Paid ends on 2 November 2026.'
    )
  })
})

describe('yearlySaving', () => {
  it('counts whole months', () => {
    expect(yearlySaving(99_900, 999_000)).toBe('2 months free')
  })

  it('says one month in the singular', () => {
    expect(yearlySaving(100_000, 1_100_000)).toBe('1 month free')
  })

  it('counts rupees when it is not whole months', () => {
    expect(yearlySaving(99_900, 1_000_000)).toBe('Save ₹1,988')
  })

  it('is null when there is no saving or no monthly price', () => {
    expect(yearlySaving(99_900, 1_198_800)).toBeNull()
    expect(yearlySaving(null, 999_000)).toBeNull()
    expect(yearlySaving(0, 999_000)).toBeNull()
  })
})
