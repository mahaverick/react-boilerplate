import type {
  PlansResponse,
  TenantBilling,
  TenantEntitlements,
  UpgradeRequestView,
} from '@/types/billing.types'
import { USER_ID_2 } from './ids'

/** One day in milliseconds, for trial ends relative to the moment a fixture is built. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The default trial end: nine days after the moment the fixture is built, so a
 * "days left" line reads 9 whatever the real date. A test that freezes the
 * clock passes its own `trialEndsAt`.
 * @returns An ISO timestamp nine days from now.
 */
function nineDaysFromNow(): string {
  return new Date(Date.now() + 9 * DAY_MS).toISOString()
}

/**
 * `GET /plans` as express serves it: Free (3 members, no `advanced_example`)
 * and Paid (unlimited members, `advanced_example`, ₹999 a month or ₹9,990 a
 * year), a 14-day trial, payments on, not GST-registered.
 */
export const testPlans: PlansResponse = {
  plans: [
    {
      key: 'free',
      name: 'Free',
      description: 'For small teams getting started.',
      sortOrder: 0,
      entitlements: { members: 3, advanced_example: false },
      prices: [],
    },
    {
      key: 'paid',
      name: 'Paid',
      description: 'For teams that need more members and every feature.',
      sortOrder: 1,
      entitlements: { members: null, advanced_example: true },
      prices: [
        { id: 'price_month', interval: 'month', amountMinor: 99_900, currency: 'INR' },
        { id: 'price_year', interval: 'year', amountMinor: 999_000, currency: 'INR' },
      ],
    },
  ],
  catalog: [
    {
      key: 'members',
      kind: 'limit',
      label: 'Members',
      description: 'People in the workspace, pending invitations included.',
    },
    {
      key: 'advanced_example',
      kind: 'feature',
      label: 'Insights',
      description: 'Joins and invitations over the last 30 days.',
    },
  ],
  trial: { enabled: true, days: 14 },
  paymentsEnabled: true,
  gstRegistered: false,
}

/**
 * `GET /tenants/:slug/entitlements` for a workspace in its Paid trial with 9
 * days left, using 2 of unlimited members, with `advanced_example` on.
 * @param overrides - Fields to replace.
 * @returns The entitlements.
 */
export function testEntitlements(overrides: Partial<TenantEntitlements> = {}): TenantEntitlements {
  return {
    plan: { key: 'paid', name: 'Paid' },
    state: 'trialing',
    trialEndsAt: nineDaysFromNow(),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDue: null,
    features: { advanced_example: true },
    limits: { members: { limit: null, used: 2, approaching: false } },
    ...overrides,
  }
}

/**
 * `GET /tenants/:slug/billing` for the same trial: no subscription, no payer,
 * payments on, no banner dismissed.
 * @param overrides - Fields to replace.
 * @returns The billing view.
 */
export function testBilling(overrides: Partial<TenantBilling> = {}): TenantBilling {
  return {
    state: 'trialing',
    plan: { key: 'paid', name: 'Paid' },
    interval: null,
    price: null,
    trialEndsAt: nineDaysFromNow(),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDue: null,
    nextSwitch: null,
    payer: null,
    billingEmail: null,
    paymentsEnabled: true,
    dismissedBanners: [],
    ...overrides,
  }
}

/**
 * One row of `GET /tenants/:slug/upgrade-requests`.
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function testUpgradeRequest(
  overrides: Partial<UpgradeRequestView> = {}
): UpgradeRequestView {
  return {
    id: 'upgrade-request-1',
    requestedBy: { userId: USER_ID_2, name: 'Grace Hopper' },
    key: 'members',
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  }
}
