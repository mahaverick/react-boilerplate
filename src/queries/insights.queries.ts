import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { planRefusalFrom } from '@/lib/plan-refusal'
import { tenantKeys } from '@/queries/tenant.queries'
import type { ApiSuccess } from '@/types/api.types'

/** `GET /tenants/:slug/insights`: the workspace's last 30 days, a Paid-only read. */
export interface TenantInsights {
  membersJoinedLast30Days: number
  invitationsSentLast30Days: number
}

/**
 * The insights read's key, under the tenant's detail key. `invalidateBilling`
 * refetches it: a gated read cached as `locked` must not outlive an upgrade.
 * @param slug - The tenant.
 */
export function insightsKey(slug: string) {
  return [...tenantKeys.detail(slug), 'insights'] as const
}

/** What the insights read resolves to when the plan lacks the feature: the API answered 402. */
export const INSIGHTS_LOCKED = 'locked'

/**
 * The insights read, keyed under the tenant's detail key so `dropTenantCache`
 * removes it with the rest. A 402 `PLAN_FEATURE_REQUIRED` resolves to
 * `'locked'` rather than rejecting, so the page draws the locked card; it
 * never retries, since a refusal does not change on a second ask. Any other
 * failure rejects.
 * @param slug - The tenant.
 */
export function insightsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: insightsKey(slug),
    retry: false,
    queryFn: async ({ signal }): Promise<TenantInsights | typeof INSIGHTS_LOCKED> => {
      try {
        return unwrap(
          await apiClient.get<ApiSuccess<TenantInsights>>(`/tenants/${slug}/insights`, { signal })
        )
      } catch (error) {
        if (planRefusalFrom(error)?.kind === 'feature') return INSIGHTS_LOCKED
        throw error
      }
    },
  })
}

/**
 * Reads the insights for a tenant.
 * @param slug - The tenant.
 * @param options - `enabled: false` asks nothing, as on a plan without the feature.
 */
export function useTenantInsights(slug: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...insightsQueryOptions(slug), enabled })
}
