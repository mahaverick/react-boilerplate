import type { QueryClient } from '@tanstack/react-query'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { tenantQueryOptions, type TenantDetail } from '@/queries/tenant.queries'

/**
 * The loader body both tenant layout routes share. It starts the tenant
 * detail read without waiting on it (the layout's `TenantGate` shows the
 * page's skeleton until it lands) and, for a navigation that commits, waits
 * for the tenant's flags, at most `FLAGS_BOOT_WAIT_MS`, so flag-driven UI such
 * as the Beta tab is right on first paint. A failed read resolves to null
 * here; the gate shows the failure from the query. Route analytics awaits the
 * read before the page view (`installRouteAnalytics`).
 *
 * It lives apart from `TenantGate` because a route's loader stays in the route
 * tree's chunk while its components are split out. The return type is written
 * out rather than named: the generated route tree's declarations must be able
 * to name it, and a named type here would have to be exported.
 */
export async function startTenantRoute({
  queryClient,
  slug,
  preload,
}: {
  queryClient: QueryClient
  slug: string
  preload: boolean
}): Promise<{ tenant: Promise<TenantDetail | null> }> {
  const tenant = queryClient.ensureQueryData(tenantQueryOptions(slug)).catch(() => null)
  if (!preload) await ensureFlags(queryClient, flagScopeFor({ slug }))
  return { tenant }
}
