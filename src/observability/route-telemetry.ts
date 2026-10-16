/**
 * @file Page views and the tenant group, driven by the router: each resolved
 * navigation first puts analytics in the destination's tenant group (or in
 * none), then captures its `$pageview`, so a page view never carries the
 * tenant of the page before it.
 */
import type { AnyRouter, RouterHistory } from '@tanstack/react-router'
import {
  capturePageview,
  clearTenantGroup,
  setTenantGroup,
  type AnalyticsTenantAccess,
} from '@/observability/telemetry'

/** The layout routes whose loader data carries the page's tenant read. */
export const TENANT_ROUTE_IDS: readonly string[] = [
  '/_app/tenants/$slug',
  '/_app/settings/workspace/$slug',
]

/** The tenant a resolved page belongs to, and how the user reached it. */
interface RouteTenant {
  id: string
  access: AnalyticsTenantAccess
}

/** Whether tenant-route loader data has the shape analytics needs to group by. */
function isRouteTenant(data: unknown): data is RouteTenant {
  if (typeof data !== 'object' || data === null) return false
  const { id, access } = data as Record<string, unknown>
  return typeof id === 'string' && (access === 'member' || access === 'platform')
}

/**
 * The longest a page view waits for its tenant read; after it the view is
 * captured with no tenant group rather than not at all.
 */
export const TENANT_GROUP_WAIT_MS = 10_000

/** A tenant layout route's loader data: its tenant read, which the page does not wait on. */
interface TenantRouteMatchData {
  tenant: Promise<unknown>
}

/** Whether a match's loader data carries a tenant read. */
function hasTenantRead(data: unknown): data is TenantRouteMatchData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { tenant?: unknown }).tenant instanceof Promise
  )
}

/**
 * `promise`'s value, or null when it rejects or `ms` passes first; the timer
 * is cleared either way.
 */
function within(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

/**
 * The tenant whose page the router has just resolved: a tenant layout match's
 * tenant read, awaited for at most `TENANT_GROUP_WAIT_MS`. The match is read
 * synchronously, before the first await, so a later navigation cannot change
 * which page this answers for. A 404 (`null`), a failure, a read past the wait
 * or any other page has none.
 * @param router - The app's router, at a resolve.
 * @returns The tenant id and how the user reached it, or null.
 */
async function resolvedTenant(router: AnyRouter): Promise<RouteTenant | null> {
  const match = router.state.matches.find((entry) => TENANT_ROUTE_IDS.includes(entry.routeId))
  if (match?.status !== 'success' || !hasTenantRead(match.loaderData)) return null
  const data = await within(match.loaderData.tenant, TENANT_GROUP_WAIT_MS)
  return isRouteTenant(data) ? { id: data.id, access: data.access } : null
}

/**
 * The location the router has just resolved, as a page view records it. Read
 * from the router's history at the resolve, since the view may be captured
 * after the user has moved on.
 * @param router - The app's router, at a resolve.
 * @returns The page's absolute URL, host and path.
 */
function resolvedPage(router: AnyRouter) {
  const { history } = router as { history: RouterHistory }
  const url = new URL(history.location.href, window.location.origin)
  return { $current_url: url.href, $host: url.host, $pathname: url.pathname }
}

/**
 * Subscribes analytics to the router's resolves. Each resolve sets or clears
 * the tenant group, then, when the path changed, captures a page view, in
 * resolve order: a tenant page's view waits for its tenant read, and every
 * later resolve waits behind it. Install it before the router's first load, so
 * the first page is counted too.
 *
 * A delayed view carries the URL read at its resolve, but the `$feature/*`
 * values and document title current when it is captured. Events the shell
 * fires while a tenant read is out (the sidebar, the bell, the switcher) carry
 * the group in force then, the previous tenant's on a switch; the tenant's own
 * content mounts only after the same read, behind the queued group.
 * @param router - The app's router.
 * @returns The unsubscribe.
 */
export function installRouteAnalytics(router: AnyRouter): () => void {
  let queue: Promise<void> = Promise.resolve()
  return router.subscribe('onResolved', ({ pathChanged }) => {
    const tenant = resolvedTenant(router)
    const page = resolvedPage(router)
    queue = queue
      .then(async () => {
        const resolved = await tenant
        if (resolved) setTenantGroup(resolved.id, resolved.access)
        else clearTenantGroup()
        if (pathChanged) capturePageview(page)
      })
      .catch(() => undefined)
  })
}
