import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { tenantKeys } from '@/queries/tenant.queries'
import type { ApiSuccess } from '@/types/api.types'

/** `GET /tenants/:slug/beta`: the reference flag-gated route, open only while `example_beta_page` is on. */
interface TenantBeta {
  slug: string
  /** When the server answered, ISO 8601. */
  enabledAt: string
}

/**
 * The beta route's answer, under the tenant prefix so the tenant's other
 * removals drop it too. A 404 means the flag closed since the page opened.
 * @param slug - The tenant.
 * @returns Options for `useQuery`.
 */
function tenantBetaQueryOptions(slug: string) {
  return queryOptions({
    queryKey: [...tenantKeys.detail(slug), 'beta'] as const,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantBeta>>(`/tenants/${slug}/beta`)),
  })
}

/**
 * The beta route's answer for a tenant.
 * @param slug - The tenant.
 * @returns The query.
 */
export function useTenantBeta(slug: string) {
  return useQuery(tenantBetaQueryOptions(slug))
}
