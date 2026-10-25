import { describe, expect, it } from 'vite-plus/test'
import { pickBillingBanner, trialDaysLeft, type BillingBannerKind } from '@/lib/billing-banner'
import { testBilling } from '@/tests/fixtures/billing'
import type { TenantBilling } from '@/types/billing.types'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2026-10-25T12:00:00.000Z')

/** The moment `ms` from `NOW`, as the API writes it. */
function at(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString()
}

/** A tenant created long before `NOW`, past the first day's quiet. */
const OLD_TENANT = at(-30 * DAY_MS)

const PAYER_LEFT = { userId: 'user-2', name: 'Priya', isMember: false }
const PAYER_HERE = { userId: 'user-2', name: 'Priya', isMember: true }

describe('pickBillingBanner', () => {
  const cases: Array<[string, Partial<TenantBilling>, string, BillingBannerKind | null]> = [
    [
      'past due',
      {
        state: 'past_due',
        pastDue: { since: at(-DAY_MS), graceEndsAt: at(6 * DAY_MS), paused: false },
      },
      OLD_TENANT,
      'past_due',
    ],
    [
      'past due with no failure details',
      { state: 'past_due', pastDue: null },
      OLD_TENANT,
      'past_due',
    ],
    [
      'paused in the UPI app',
      {
        state: 'past_due',
        pastDue: { since: at(-DAY_MS), graceEndsAt: at(6 * DAY_MS), paused: true },
      },
      OLD_TENANT,
      'paused',
    ],
    [
      'past due outranks a payer who left',
      {
        state: 'past_due',
        payer: PAYER_LEFT,
        pastDue: { since: at(-DAY_MS), graceEndsAt: null, paused: false },
      },
      OLD_TENANT,
      'past_due',
    ],
    [
      'active with a payer who left',
      { state: 'active', payer: PAYER_LEFT, currentPeriodEnd: at(20 * DAY_MS) },
      OLD_TENANT,
      'payer_left',
    ],
    [
      'active with a payer who is still a member',
      { state: 'active', payer: PAYER_HERE, currentPeriodEnd: at(20 * DAY_MS) },
      OLD_TENANT,
      null,
    ],
    [
      'active with no payer account',
      { state: 'active', payer: null, currentPeriodEnd: at(20 * DAY_MS) },
      OLD_TENANT,
      null,
    ],
    [
      'trialing, 3 days left',
      { state: 'trialing', trialEndsAt: at(3 * DAY_MS) },
      OLD_TENANT,
      'trial_ending',
    ],
    [
      'trialing, 3 days left, on the first day',
      { state: 'trialing', trialEndsAt: at(3 * DAY_MS) },
      at(-HOUR_MS),
      'trial_ending',
    ],
    [
      'trialing past its end before the job runs',
      { state: 'trialing', trialEndsAt: at(-HOUR_MS) },
      OLD_TENANT,
      'trial_ending',
    ],
    [
      'trialing, 4 days left',
      { state: 'trialing', trialEndsAt: at(4 * DAY_MS) },
      OLD_TENANT,
      'trial_running',
    ],
    [
      'trialing in the first 24 hours',
      { state: 'trialing', trialEndsAt: at(13 * DAY_MS) },
      at(-23 * HOUR_MS),
      null,
    ],
    [
      'trialing just past the first 24 hours',
      { state: 'trialing', trialEndsAt: at(13 * DAY_MS) },
      at(-25 * HOUR_MS),
      'trial_running',
    ],
    ['trialing with no end', { state: 'trialing', trialEndsAt: null }, OLD_TENANT, null],
    [
      'free after a trial ended a day ago',
      { state: 'free', trialEndsAt: at(-DAY_MS) },
      OLD_TENANT,
      'trial_ended',
    ],
    [
      'free after a trial ended 14 days ago',
      { state: 'free', trialEndsAt: at(-14 * DAY_MS) },
      OLD_TENANT,
      'trial_ended',
    ],
    [
      'free after a trial ended 15 days ago',
      { state: 'free', trialEndsAt: at(-15 * DAY_MS) },
      OLD_TENANT,
      null,
    ],
    [
      'free after a dismissed trial end',
      { state: 'free', trialEndsAt: at(-DAY_MS), dismissedBanners: ['trial_ended'] },
      OLD_TENANT,
      null,
    ],
    ['free with no trial', { state: 'free', trialEndsAt: null }, OLD_TENANT, null],
    [
      'active and paid up',
      { state: 'active', currentPeriodEnd: at(20 * DAY_MS) },
      OLD_TENANT,
      null,
    ],
  ]

  it.each(cases)('%s', (_name, overrides, createdAt, expected) => {
    expect(pickBillingBanner(testBilling(overrides), NOW, createdAt)).toBe(expected)
  })
})

describe('trialDaysLeft', () => {
  it('counts a part day as a day', () => {
    expect(trialDaysLeft(at(9 * DAY_MS - HOUR_MS), NOW)).toBe(9)
    expect(trialDaysLeft(at(9 * DAY_MS), NOW)).toBe(9)
  })
})
