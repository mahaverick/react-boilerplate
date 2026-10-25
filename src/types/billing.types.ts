/**
 * The billing API contract (docs/2026-10-24-billing-api-contract.md), as the
 * server sends it. Money is integer minor units (paise) plus `currency`;
 * timestamps are ISO 8601 UTC strings.
 */

/** The plans the API serves. */
export type PlanKey = 'free' | 'paid'

/** Where a workspace is in its billing lifecycle. `trialing` and `active` and `past_due` are all on Paid. */
export type BillingState = 'trialing' | 'free' | 'active' | 'past_due'

/** How often a Paid subscription charges. */
export type BillingInterval = 'month' | 'year'

/** A catalog entry is an on/off feature or a numeric limit. */
export type EntitlementKind = 'feature' | 'limit'

/** One entitlement the catalog names, with the wording the app shows for it. */
export interface EntitlementCatalogEntry {
  key: string
  kind: EntitlementKind
  label: string
  description: string
}

/** A plan's value for one entitlement: a feature is a boolean, a limit is a number, and `null` is unlimited. */
export type EntitlementValue = boolean | number | null

/** One price of a plan. */
export interface PriceView {
  id: string
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
}

/** One limit's use. `approaching` is `used >= ceil(limit * softAt)` and `used < limit`. */
export interface LimitUsage {
  limit: number | null
  used: number
  approaching: boolean
}

/** A failed card payment. `graceEndsAt` is `null` while Razorpay is still retrying. */
export interface PastDue {
  since: string
  graceEndsAt: string | null
  paused: boolean
}

/** `GET /tenants/:slug/entitlements`: what the workspace may use now. */
export interface TenantEntitlements {
  /** The effective plan: Paid while trialing, active or past due. */
  plan: { key: PlanKey; name: string }
  /** The effective state: a lapsed trial reads `free` before the job runs. */
  state: BillingState
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  features: Record<string, boolean>
  limits: Record<string, LimitUsage>
}

/** One plan on `GET /plans`. */
export interface PublicPlan {
  key: PlanKey
  name: string
  description: string
  sortOrder: number
  entitlements: Record<string, EntitlementValue>
  prices: PriceView[]
}

/** `GET /plans`, public and cacheable for 60 seconds. */
export interface PlansResponse {
  plans: PublicPlan[]
  catalog: EntitlementCatalogEntry[]
  trial: { enabled: boolean; days: number }
  paymentsEnabled: boolean
  gstRegistered: boolean
}

/** Where in the app an upgrade request came from. */
export type UpgradeSurface = 'limit' | 'feature' | 'banner' | 'billing_page' | 'pricing'

/** `GET /tenants/:slug/billing`. Owner-only fields are `null` for everyone else and for staff. */
export interface TenantBilling {
  state: BillingState
  plan: { key: PlanKey; name: string }
  interval: BillingInterval | null
  /** The price this tenant pays, which may be a retired one. */
  price: PriceView | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  /** Set once the next subscription is authenticated: a switch, or a resubscribe while cancelling. */
  nextSwitch: { interval: BillingInterval; startsAt: string } | null
  /** Who pays. `isMember: false` means the payer left the workspace. */
  payer: { userId: string; name: string; isMember: boolean } | null
  /** Owner only. */
  billingEmail: string | null
  paymentsEnabled: boolean
  dismissedBanners: string[]
}

/** What the server returns to open Razorpay Checkout. */
export interface CheckoutSession {
  purpose: 'upgrade' | 'switch' | 'card_change'
  /** `rzp_test_…` or `rzp_live_…`. */
  keyId: string
  subscriptionId: string
  amountMinor: number
  currency: 'INR'
  interval: BillingInterval
  /** The deferred first charge: the trial's end or the period's end. */
  startsAt: string | null
  prefill: { name: string; email: string }
}

/** The body of `POST /billing/checkout/confirm`: what Razorpay Checkout hands back. */
export interface CheckoutConfirm {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

/** One row of `GET /billing/invoices`. */
export interface InvoiceView {
  id: string
  amountMinor: number
  currency: 'INR'
  status: 'issued' | 'paid' | 'cancelled' | 'expired'
  issuedAt: string
  paidAt: string | null
  url: string | null
}

/** `POST /upgrade-requests`. */
export interface UpgradeRequestResult {
  id: string
  createdAt: string
  alreadyRequested: boolean
}

/** One row of `GET /upgrade-requests`, for owners. */
export interface UpgradeRequestView {
  id: string
  requestedBy: { userId: string; name: string }
  key: string | null
  createdAt: string
}

/** `GET /tenants/:slug/insights`: the reference Paid-only feature. */
export interface TenantInsights {
  membersJoinedLast30Days: number
  invitationsSentLast30Days: number
}

/** An entitlement override staff granted a workspace. A feature grant's value is always `true`. */
export interface Grant {
  id: string
  key: string
  value: EntitlementValue
  reason: string
  /** `null` when the account was purged or a script wrote the grant. */
  grantedBy: { userId: string; name: string } | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

/** `GET /platform/tenants/:id/billing`: the customer view plus provider ids, grants and history. */
export interface StaffTenantBilling extends TenantBilling {
  provider: 'razorpay' | 'fake' | null
  providerMode: 'test' | 'live' | null
  providerSubscriptionId: string | null
  pendingSubscriptionId: string | null
  nextSubscriptionId: string | null
  syncedAt: string | null
  disputeOpen: boolean
  entitlements: TenantEntitlements
  sources: Record<string, 'plan' | 'grant'>
  grants: Grant[]
  /** The newest 20. */
  history: Array<{
    from: BillingState | null
    to: BillingState
    cause: string
    source: 'webhook' | 'confirm' | 'reconcile' | 'job' | 'staff' | 'owner'
    at: string
  }>
  /** The newest 20. */
  events: Array<{
    type: string
    receivedAt: string
    processedAt: string | null
    error: string | null
  }>
}

/** One plan on the staff plans screen. */
export interface StaffPlan {
  id: string
  key: PlanKey
  name: string
  description: string
  version: number
  entitlements: Record<string, EntitlementValue>
  prices: Array<
    PriceView & {
      active: boolean
      createdAt: string
      retiredAt: string | null
      subscribers: number
    }
  >
  tenantCounts: Record<BillingState, number>
}

/** `GET /platform/plans`. */
export interface StaffPlans {
  plans: StaffPlan[]
  catalog: EntitlementCatalogEntry[]
  priceWarningAboveMinor: 1500000
}

/** `POST /platform/plans/:id/preview`: what a plan edit changes and who it touches. */
export interface PlanChangePreview {
  changes: Array<{
    key: string
    from: EntitlementValue
    to: EntitlementValue
    direction: 'increase' | 'decrease'
  }>
  affected: { trialing: number; active: number; past_due: number; free: number }
}

/** `GET /platform/billing-settings`. */
export interface BillingSettings {
  trialEnabled: boolean
  trialDays: number
  pastDueGraceDays: number
  version: number
  updatedAt: string
  updatedBy: { userId: string; name: string } | null
}

/** One row of `GET /platform/billing/alerts`. */
export interface BillingAlert {
  id: string
  kind:
    | 'duplicate_refunded'
    | 'webhook_failing'
    | 'reconcile_repair'
    | 'dispute'
    | 'subscription_completed'
  tenant: { id: string; name: string } | null
  message: string
  at: string
}
