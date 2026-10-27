import type {
  PlansResponse,
  TenantBilling,
  TenantEntitlements,
  UpgradeRequestView,
} from '@/types/billing.types'
import { USER_ID, USER_ID_2 } from './ids'

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
    taxDocumentsEnabled: false,
    hasTaxDocuments: false,
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

/**
 * The billing states the e2e harness serves under `?billing=` and the capture
 * stubs for its state shots. `trialing` is the default.
 */
export const BILLING_STATES = [
  'trialing',
  'trial_ending',
  'free',
  'free_over',
  'active',
  'active_cancelling',
  'past_due',
  'paused',
  'payer_left',
  'payments_off',
] as const

/** One of `BILLING_STATES`. */
export type BillingStateName = (typeof BILLING_STATES)[number]

/**
 * The current period's end in the Paid states: "2 November 2026" in every
 * time zone from UTC−10 to UTC+13, since 10:00 UTC is midnight at UTC−10 and
 * 23:00 at UTC+13; the harness tenant's Europe/London is one of them. Fixed,
 * unlike the trial's end, because nothing in those states compares it with
 * the clock.
 */
const PERIOD_END = '2026-11-02T10:00:00.000Z'

/** When the failed payment in `past_due` and `paused` failed: "20 October 2026". */
const PAYMENT_FAILED_ON = '2026-10-20T10:00:00.000Z'

/** The end of the grace period in `past_due` and `paused`: "27 October 2026". */
const GRACE_ENDS_AT = '2026-10-27T10:00:00.000Z'

/** Free's member limit, as `testPlans` sets it. */
const FREE_MEMBER_LIMIT = 3

/**
 * A members limit's use as the API reports it, with `approaching` from a soft
 * limit at 80%.
 * @param used - Members plus pending invitations.
 * @param limit - The plan's limit, or `null` for none.
 * @returns The usage.
 */
export function membersUsage(
  used: number,
  limit: number | null
): TenantEntitlements['limits'][string] {
  return {
    limit,
    used,
    approaching: limit !== null && used >= Math.ceil(limit * 0.8) && used < limit,
  }
}

/** Who pays and where receipts go in the Paid states. */
export interface BillingPeople {
  /** The payer's name, a member of the workspace. */
  payerName: string
  /** The payer who left, in `payer_left`. */
  formerPayerName: string
  billingEmail: string
}

/** The harness's people: its owner A B pays, and Cleo D is the payer who left. */
const DEFAULT_PEOPLE: BillingPeople = {
  payerName: 'A B',
  formerPayerName: 'Cleo D',
  billingEmail: 'a@b.com',
}

/** A state's views, and whether payments are on for the whole platform. */
export interface BillingStateFixture {
  billing: TenantBilling
  entitlements: TenantEntitlements
  /** `GET /plans`'s `paymentsEnabled`, which matches the view's. */
  paymentsEnabled: boolean
}

/**
 * The billing view and entitlements of one named state. The trial states
 * end relative to now, as their banners count days; the Paid states use the
 * fixed dates above.
 * @param name - The state.
 * @param people - The payer's names and the billing email, for the PII probe.
 * @returns The views.
 */
export function billingState(
  name: BillingStateName,
  people: BillingPeople = DEFAULT_PEOPLE
): BillingStateFixture {
  const monthly = testPlans.plans[1]!.prices[0]!
  const free = {
    billing: testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null }),
    entitlements: testEntitlements({
      plan: { key: 'free', name: 'Free' },
      state: 'free',
      trialEndsAt: null,
      features: { advanced_example: false },
      limits: { members: membersUsage(2, FREE_MEMBER_LIMIT) },
    }),
  }
  /** A Paid state: monthly, renewing on `PERIOD_END`, paid by the first member. */
  const paid = (overrides: Partial<TenantBilling>, entitlements: Partial<TenantEntitlements>) => ({
    billing: testBilling({
      state: 'active',
      interval: 'month',
      price: monthly,
      trialEndsAt: null,
      currentPeriodEnd: PERIOD_END,
      payer: { userId: USER_ID, name: people.payerName, isMember: true },
      billingEmail: people.billingEmail,
      ...overrides,
    }),
    entitlements: testEntitlements({
      state: 'active',
      trialEndsAt: null,
      currentPeriodEnd: PERIOD_END,
      ...entitlements,
    }),
  })
  /** A failed payment, still retrying or paused in the UPI app. */
  const pastDue = (paused: boolean) =>
    paid(
      {
        state: 'past_due',
        pastDue: { since: PAYMENT_FAILED_ON, graceEndsAt: GRACE_ENDS_AT, paused },
      },
      {
        state: 'past_due',
        pastDue: { since: PAYMENT_FAILED_ON, graceEndsAt: GRACE_ENDS_AT, paused },
      }
    )
  const views: Record<BillingStateName, Omit<BillingStateFixture, 'paymentsEnabled'>> = {
    trialing: { billing: testBilling(), entitlements: testEntitlements() },
    trial_ending: {
      billing: testBilling({ trialEndsAt: daysFromNow(2) }),
      entitlements: testEntitlements({ trialEndsAt: daysFromNow(2) }),
    },
    free,
    free_over: {
      billing: free.billing,
      entitlements: {
        ...free.entitlements,
        limits: { members: membersUsage(5, FREE_MEMBER_LIMIT) },
      },
    },
    active: paid({}, {}),
    active_cancelling: paid({ cancelAtPeriodEnd: true }, { cancelAtPeriodEnd: true }),
    past_due: pastDue(false),
    paused: pastDue(true),
    payer_left: paid(
      { payer: { userId: USER_ID_2, name: people.formerPayerName, isMember: false } },
      {}
    ),
    payments_off: {
      billing: testBilling({ paymentsEnabled: false }),
      entitlements: testEntitlements(),
    },
  }
  return { ...views[name], paymentsEnabled: name !== 'payments_off' }
}

/**
 * A moment some days from now.
 * @param days - How many days ahead.
 * @returns The ISO timestamp.
 */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}
