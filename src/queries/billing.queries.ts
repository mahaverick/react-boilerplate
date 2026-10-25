import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { tenantKeys, useTenant } from '@/queries/tenant.queries'
import type { ApiSuccess } from '@/types/api.types'
import type {
  BillingInterval,
  CheckoutConfirm,
  CheckoutSession,
  InvoiceView,
  LimitUsage,
  PlansResponse,
  TenantBilling,
  TenantEntitlements,
  UpgradeRequestResult,
  UpgradeRequestView,
  UpgradeSurface,
} from '@/types/billing.types'
import type { ListPage } from '@/types/list.types'

/**
 * The billing query keys. Every tenant key sits under `tenantKeys.detail(slug)`,
 * so `dropTenantCache` removes them with the rest of the tenant; the invoices
 * sit under the billing key. The public plans are not a tenant's.
 */
export const billingKeys = {
  plans: ['plans'] as const,
  entitlements: tenantKeys.entitlements,
  billing: (slug: string) => ['tenants', slug, 'billing'] as const,
  invoices: (slug: string) => ['tenants', slug, 'billing', 'invoices'] as const,
  upgradeRequests: (slug: string) => ['tenants', slug, 'upgrade-requests'] as const,
}

/** How long `GET /plans` stays fresh: the API marks it cacheable for 60 seconds. */
const PLANS_STALE_MS = 60_000

/** `GET /plans`: the public plans, prices, catalog and trial, signed in or out. */
export function plansQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.plans,
    queryFn: async ({ signal }) =>
      unwrap(await apiClient.get<ApiSuccess<PlansResponse>>('/plans', { signal })),
    staleTime: PLANS_STALE_MS,
  })
}

/** The public plans. */
export function usePlans() {
  return useQuery(plansQueryOptions())
}

/** `GET /tenants/:slug/entitlements`: any member, and staff through platform access. */
export function entitlementsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: billingKeys.entitlements(slug),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<TenantEntitlements>>(`/tenants/${slug}/entitlements`, {
          signal,
        })
      ),
  })
}

/** What a tenant's plan allows now, and how much of each limit is in use. */
export function useEntitlements(slug: string) {
  return useQuery(entitlementsQueryOptions(slug))
}

/**
 * Whether a tenant's plan includes a feature: `undefined` until the
 * entitlements load, then `false` for a key the plan does not list.
 * @param slug - The tenant.
 * @param key - The catalog key, such as `advanced_example`.
 */
export function useFeature(slug: string, key: string): { enabled: boolean | undefined } {
  const { data } = useEntitlements(slug)
  return { enabled: data === undefined ? undefined : data.features[key] === true }
}

/**
 * One limit's use, or `undefined` until the entitlements load or when the
 * plan does not limit `key`.
 * @param slug - The tenant.
 * @param key - The catalog key, such as `members`.
 */
export function useLimit(slug: string, key: string): LimitUsage | undefined {
  return useEntitlements(slug).data?.limits[key]
}

/**
 * `GET /tenants/:slug/billing`, where a 404 resolves to `null` rather than
 * rejecting, so it is never retried. Only the platform tenant, which has no
 * billing row, and an API older than billing answer 404; payments being off
 * is `paymentsEnabled: false` on a 200. Every other failure rejects.
 */
export function tenantBillingQueryOptions(slug: string) {
  return queryOptions({
    queryKey: billingKeys.billing(slug),
    queryFn: async ({ signal }): Promise<TenantBilling | null> => {
      try {
        return unwrap(
          await apiClient.get<ApiSuccess<TenantBilling>>(`/tenants/${slug}/billing`, { signal })
        )
      } catch (error) {
        if (statusFrom(error) === 404) return null
        throw error
      }
    },
  })
}

/**
 * A tenant's billing view. It waits for the tenant's detail and never runs
 * for the platform tenant, which has no billing.
 * @param slug - The tenant.
 */
export function useTenantBilling(slug: string) {
  const tenant = useTenant(slug)
  return useQuery({
    ...tenantBillingQueryOptions(slug),
    enabled: tenant.data?.isPlatform === false,
  })
}

/** Whether a read runs: the billing page passes `false` unless the caller is an owner with member access and payments are on. */
interface EnabledOption {
  enabled?: boolean
}

/**
 * One page of `GET /tenants/:slug/billing/invoices`, newest first. Owner only;
 * a 404 when payments are off.
 * @param slug - The tenant.
 * @param cursor - The page to read; the first when absent.
 * @param options - `enabled: false` asks nothing.
 */
export function invoicesQueryOptions(
  slug: string,
  cursor?: string,
  { enabled = true }: EnabledOption = {}
) {
  return queryOptions({
    queryKey: [...billingKeys.invoices(slug), cursor ?? null] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<ListPage<InvoiceView>>>(
          `/tenants/${slug}/billing/invoices`,
          { params: cursor === undefined ? {} : { cursor }, signal }
        )
      ),
    enabled,
  })
}

/**
 * `GET /tenants/:slug/upgrade-requests`: the members who asked an owner to
 * upgrade. Owner only.
 * @param slug - The tenant.
 * @param options - `enabled: false` asks nothing.
 */
export function upgradeRequestsQueryOptions(slug: string, { enabled = true }: EnabledOption = {}) {
  return queryOptions({
    queryKey: billingKeys.upgradeRequests(slug),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<UpgradeRequestView[]>>(`/tenants/${slug}/upgrade-requests`, {
          signal,
        })
      ),
    enabled,
  })
}

/**
 * Refetches everything a billing change moves: entitlements, the billing view,
 * invoices and upgrade requests. The public plans stay.
 * @param queryClient - The app's query client.
 * @param slug - The tenant.
 */
export async function invalidateBilling(queryClient: QueryClient, slug: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: billingKeys.entitlements(slug) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.billing(slug) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.invoices(slug) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.upgradeRequests(slug) }),
  ])
}

/**
 * Stores a write's billing answer and refetches the rest it moves, without
 * refetching the billing view it just stored.
 * @param queryClient - The app's query client.
 * @param slug - The tenant.
 * @param billing - The write's answer.
 */
async function storeBilling(
  queryClient: QueryClient,
  slug: string,
  billing: TenantBilling
): Promise<void> {
  queryClient.setQueryData(billingKeys.billing(slug), billing)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: billingKeys.entitlements(slug) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.invoices(slug) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.upgradeRequests(slug) }),
  ])
}

/**
 * Opens a Paid subscription: `POST /billing/checkout` answers what Razorpay
 * Checkout needs. Owner with member access.
 * @param slug - The tenant.
 */
export function useStartCheckout(slug: string) {
  return useMutation({
    mutationFn: async (input: { interval: BillingInterval }) =>
      unwrap(
        await apiClient.post<ApiSuccess<CheckoutSession>>(
          `/tenants/${slug}/billing/checkout`,
          input
        )
      ),
  })
}

/**
 * Schedules a switch to the other interval: `POST /billing/interval` answers a
 * checkout session with `purpose: 'switch'`. Owner with member access.
 * @param slug - The tenant.
 */
export function useSwitchInterval(slug: string) {
  return useMutation({
    mutationFn: async (input: { interval: BillingInterval }) =>
      unwrap(
        await apiClient.post<ApiSuccess<CheckoutSession>>(
          `/tenants/${slug}/billing/interval`,
          input
        )
      ),
  })
}

/**
 * Starts a card change: `POST /billing/payment-method` answers a checkout
 * session with `purpose: 'card_change'`. Owner with member access.
 * @param slug - The tenant.
 */
export function useUpdateCard(slug: string) {
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.post<ApiSuccess<CheckoutSession>>(
          `/tenants/${slug}/billing/payment-method`,
          {}
        )
      ),
  })
}

/**
 * Hands Razorpay Checkout's answer to the API, which verifies it and answers
 * the billing view. The answer is stored as the billing view, and the
 * entitlements refetch.
 * @param slug - The tenant.
 */
export function useConfirmCheckout(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CheckoutConfirm) =>
      unwrap(
        await apiClient.post<ApiSuccess<TenantBilling>>(
          `/tenants/${slug}/billing/checkout/confirm`,
          input
        )
      ),
    onSuccess: (billing) => storeBilling(queryClient, slug, billing),
  })
}

/**
 * Cancels Paid at the period's end, or a subscription that has not charged
 * yet. The answer is stored as the billing view, and the entitlements refetch.
 * @param slug - The tenant.
 */
export function useCancelPaid(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.post<ApiSuccess<TenantBilling>>(`/tenants/${slug}/billing/cancel`, {})
      ),
    onSuccess: (billing) => storeBilling(queryClient, slug, billing),
  })
}

/**
 * Asks the owners to upgrade. Any member but an owner; `alreadyRequested`
 * says the caller had asked already.
 * @param slug - The tenant.
 */
export function useRequestUpgrade(slug: string) {
  return useMutation({
    mutationFn: async (input: { key?: string; surface: UpgradeSurface }) =>
      unwrap(
        await apiClient.post<ApiSuccess<UpgradeRequestResult>>(
          `/tenants/${slug}/upgrade-requests`,
          input
        )
      ),
  })
}

/**
 * Hides a banner for the caller. On settle it invalidates all four billing
 * keys (entitlements, billing view, invoices, upgrade requests); the view
 * carries `dismissedBanners`, so a refusal also shows the server's state.
 * @param slug - The tenant.
 */
export function useDismissBanner(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (banner: 'trial_ended') =>
      unwrap(
        await apiClient.post<ApiSuccess<null>>(`/tenants/${slug}/banner-dismissals`, { banner })
      ),
    onSettled: () => invalidateBilling(queryClient, slug),
  })
}
