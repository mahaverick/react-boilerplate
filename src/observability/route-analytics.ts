/**
 * @file Page views and the tenant group, driven by the router: each resolved
 * navigation first puts analytics in the destination's tenant group (or in
 * none), then captures its `$pageview`, so a page view never carries the
 * tenant of the page before it.
 */
import type { AnyRouter } from '@tanstack/react-router'
import {
  capturePageview,
  clearTenantGroup,
  setTenantGroup,
  type AnalyticsTenantAccess,
} from '@/observability/analytics'

/** The layout route every tenant page sits under; its loader resolves the tenant. */
export const TENANT_ROUTE_ID = '/_app/tenants/$slug'

interface RouteTenant {
  id: string
  access: AnalyticsTenantAccess
}

function isRouteTenant(data: unknown): data is RouteTenant {
  if (typeof data !== 'object' || data === null) return false
  const { id, access } = data as Record<string, unknown>
  return typeof id === 'string' && (access === 'member' || access === 'platform')
}

/**
 * The tenant whose page the router has resolved: the tenant route's loader
 * data, when that route matched and loaded one. A 404 (`null`), a failed
 * load or any other page has none.
 * @param router - The app's router, after a resolve.
 * @returns The tenant id and how the user reached it, or null.
 */
function resolvedTenant(router: AnyRouter): RouteTenant | null {
  const match = router.state.matches.find((entry) => entry.routeId === TENANT_ROUTE_ID)
  if (match?.status !== 'success') return null
  const data: unknown = match.loaderData
  return isRouteTenant(data) ? { id: data.id, access: data.access } : null
}

/**
 * Subscribes analytics to the router's resolves. Every resolve sets or
 * clears the tenant group, a reload of the same page included; only a new
 * path is a page view, as posthog-js counts them. Install it before the
 * router's first load, so the first page is counted too.
 * @param router - The app's router.
 * @returns The unsubscribe.
 */
export function installRouteAnalytics(router: AnyRouter): () => void {
  return router.subscribe('onResolved', ({ pathChanged }) => {
    const tenant = resolvedTenant(router)
    if (tenant) setTenantGroup(tenant.id, tenant.access)
    else clearTenantGroup()
    if (pathChanged) capturePageview()
  })
}
