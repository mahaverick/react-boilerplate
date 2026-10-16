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
 * `promise`'s value, or null when it rejects, `ms` passes first or `cut` settles;
 * the timer is cleared either way.
 */
function within(promise: Promise<unknown>, ms: number, cut: Promise<void>): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    /** Settles with `value` and stops the timer. */
    const settle = (value: unknown) => {
      clearTimeout(timer)
      resolve(value)
    }
    promise.then(settle, () => settle(null))
    void cut.then(() => settle(null))
  })
}

/**
 * The tenant layout match of the page the router has just resolved, when its
 * loader started a tenant read.
 * @param router - The app's router, at a resolve.
 * @returns The match's tenant read, or null for any other page.
 */
function tenantRead(router: AnyRouter): Promise<unknown> | null {
  const match = router.state.matches.find((entry) => TENANT_ROUTE_IDS.includes(entry.routeId))
  if (match?.status !== 'success' || !hasTenantRead(match.loaderData)) return null
  return match.loaderData.tenant
}

/**
 * The tenant whose page the router has just resolved: a tenant layout match's
 * tenant read, awaited for at most `TENANT_GROUP_WAIT_MS`, or until a newer
 * tenant page resolves (`cut`). A 404 (`null`), a failure, a read past the wait,
 * a cut wait or any other page has none.
 * @param read - The page's tenant read, taken synchronously at its resolve so a
 * later navigation cannot change which page this answers for; null for a page
 * without one.
 * @param cut - Settles when a newer tenant page resolves.
 * @returns The tenant id and how the user reached it, or null.
 */
async function resolvedTenant(
  read: Promise<unknown> | null,
  cut: Promise<void>
): Promise<RouteTenant | null> {
  if (!read) return null
  const data = await within(read, TENANT_GROUP_WAIT_MS, cut)
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
 * later resolve waits behind it. A newer tenant page cuts an earlier page's
 * wait short, so that earlier view is captured at once with no group and the
 * newer page's events never carry an older tenant's. Install it before the
 * router's first load, so the first page is counted too.
 *
 * A tenant page's resolve takes analytics out of any group at once, until its
 * read lands, so events the shell fires meanwhile (the sidebar, the bell, the
 * switcher) carry no group rather than the previous tenant's. A delayed view
 * carries the URL read at its resolve, but the `$feature/*` values and
 * document title current when it is captured.
 * @param router - The app's router.
 * @returns The unsubscribe.
 */
export function installRouteAnalytics(router: AnyRouter): () => void {
  let queue: Promise<void> = Promise.resolve()
  let cutEarlier: (() => void) | null = null
  return router.subscribe('onResolved', ({ pathChanged }) => {
    const read = tenantRead(router)
    let cut: Promise<void> = Promise.resolve()
    if (read) {
      cutEarlier?.()
      cut = new Promise<void>((resolve) => {
        cutEarlier = resolve
      })
      clearTenantGroup()
    }
    const tenant = resolvedTenant(read, cut)
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
