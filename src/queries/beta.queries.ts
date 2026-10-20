import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { tenantKeys } from '@/queries/tenant.queries'
import type { ApiSuccess } from '@/types/api.types'

/** `GET /tenants/:slug/beta`: the reference flag-gated route, open only while the `example_beta_page` flag is on. */
interface TenantBeta {
  slug: string
  /** When the server answered, ISO 8601. */
  enabledAt: string
}

/**
 * The beta route's answer, keyed under the tenant's detail key so
 * `dropTenantCache` removes it with the rest. While the flag is off it answers
 * 404: a closed gate answers the unknown-route 404.
 */
function tenantBetaQueryOptions(slug: string) {
  return queryOptions({
    queryKey: [...tenantKeys.detail(slug), 'beta'] as const,
    queryFn: async ({ signal }) =>
      unwrap(await apiClient.get<ApiSuccess<TenantBeta>>(`/tenants/${slug}/beta`, { signal })),
  })
}

/** Reads the beta route for a tenant; it rejects with a 404 while the flag is off. */
export function useTenantBeta(slug: string) {
  return useQuery(tenantBetaQueryOptions(slug))
}
