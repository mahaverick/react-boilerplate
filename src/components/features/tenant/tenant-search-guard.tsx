import { useQuery } from '@tanstack/react-query'
import {
  useLocation,
  useMatches,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { correctTenant } from '@/lib/tenant-guard'
import { tenantsQueryOptions } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

/** Renders `component`, a route's pending template, or nothing when there is none. */
function renderRouteComponent(component: ComponentType | undefined): ReactNode {
  return component ? createElement(component) : null
}

/**
 * The pending template of the route directly under `_app`, the one the router
 * would show for the page: the dashboard's on `/dashboard`, the router-wide list
 * template on `/tenants`.
 */
function MatchedPending() {
  const router = useRouter()
  const routeId = useMatches({
    select: (matches) =>
      matches[matches.findIndex((match) => match.routeId === '/_app') + 1]?.routeId,
  })
  const route = routeId ? router.routesById[routeId] : undefined
  return renderRouteComponent(
    route?.options.pendingComponent ?? router.options.defaultPendingComponent
  )
}

/**
 * The `_app` page slot's tenant decision, made after the shell has mounted.
 * A `$slug` page needs no list: its tenant is the path, and any `?tenant` is
 * dropped. Any other page waits on the caller's tenant list, showing in the
 * page slot (the sidebar and header are already up) the pending template of
 * the route directly under `_app`, the one the router would show for it, then
 * moves to the resolved `?tenant` with a replace and remembers it for the user. A failed list renders the page with the URL as it is; the
 * tenant switcher says the list failed and offers a retry. It decides only
 * while the router is idle, when the location and the rendered matches are
 * the same page's, so a page reached with an ineligible `?tenant` (a stale
 * history entry) may render once with it before the guard replaces it.
 */
export function TenantSearchGuard({ children }: { children: ReactNode }) {
  const { slug } = useParams({ strict: false })
  const onSlugPage = slug !== undefined
  const raw = useLocation({
    select: (location) => (location.search as Record<string, unknown>).tenant,
  })
  const { tenant: requested } = useSearch({ from: '/_app' })
  const userId = useAuthStore((state) => state.user?.id)
  const remembered = useCurrentTenantStore((state) =>
    userId ? (state.remembered[userId] ?? readRememberedTenant(userId)) : null
  )
  const remember = useCurrentTenantStore((state) => state.remember)
  const navigate = useNavigate()
  // Mid-navigation the location is the next page's while the params and search are still this one's.
  const settled = useRouterState({ select: (state) => state.status === 'idle' })
  const list = useQuery({ ...tenantsQueryOptions(), enabled: !onSlugPage })
  const pathname = useLocation({ select: (location) => location.pathname })
  const failed = list.data === undefined && (list.failureCount > 0 || list.errorUpdateCount > 0)
  /** The path whose page this guard already released on a failed list read; a later correction there must not swap it for the template and back. */
  const [releasedPath, setReleasedPath] = useState<string | null>(null)
  // Derived during render, as React allows for state that follows props.
  if (failed && !onSlugPage && releasedPath !== pathname) setReleasedPath(pathname)

  const decision =
    !settled || onSlugPage || list.data === undefined
      ? null
      : correctTenant({ list: list.data, raw, requested, remembered })
  const resolved = decision?.resolved ?? null
  /** Where `?tenant` must move: a slug, `''` to remove it, or null to stay. */
  const target = !settled
    ? null
    : onSlugPage
      ? raw === undefined
        ? null
        : ''
      : decision?.correction
        ? (decision.correction.tenant ?? '')
        : null

  useEffect(() => {
    if (resolved !== null && userId && resolved !== remembered) remember(userId, resolved)
  }, [resolved, remembered, remember, userId])

  useEffect(() => {
    if (target === null) return
    const tenant = target === '' ? undefined : target
    // An explicit `tenant` key, `undefined` included, so `retainTenant` does not put the old value back.
    void navigate({ to: '.', search: (prev) => ({ ...prev, tenant }), replace: true })
  }, [target, navigate])

  if (onSlugPage) return children
  // Once a read has failed, its retry and any refetch (a page's own read mounting retries it) keep the page up.
  if (failed) return children
  if (list.data === undefined || (target !== null && releasedPath !== pathname)) {
    return <MatchedPending />
  }
  return children
}
