import type { QueryClient } from '@tanstack/react-query'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { tenantQueryOptions } from '@/queries/tenant.queries'

/**
 * The loader body every tenant layout route shares: warm the tenant detail
 * and, for a navigation that commits, the tenant's flags in parallel. A hover
 * preload reads only the detail. `ensureFlags` never rejects.
 *
 * It lives apart from `TenantGate` because a route's loader stays in the route
 * tree's chunk while its components are split out: importing it from the gate's
 * module would pull the gate, and the error reporting it imports, into the
 * entry's static graph.
 */
export async function loadTenantRoute({
  queryClient,
  slug,
  preload,
}: {
  queryClient: QueryClient
  slug: string
  preload: boolean
}): Promise<unknown> {
  const detail = queryClient.ensureQueryData(tenantQueryOptions(slug))
  if (preload) return detail
  const [tenant] = await Promise.all([detail, ensureFlags(queryClient, flagScopeFor({ slug }))])
  return tenant
}
