import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { RouteError } from '@/components/features/route-error'
import { RouteNotFound } from '@/components/features/route-not-found'
import { RoutePending } from '@/components/features/route-pending'
import {
  ensureSession,
  installAnalyticsIdentity,
  installAuthBroadcastListener,
  isAuthVerdict,
} from '@/http/session'
import { forgetStaleIdentity } from '@/observability/analytics'
import { setErrorRouteSource } from '@/observability/errors'
import {
  installFlagScopeReset,
  installRouteFeatureProperties,
} from '@/observability/flags/flag-scope'
import { installRouteAnalytics } from '@/observability/route-analytics'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

/**
 * Restore the session once per page load. The access token is memory-only, so
 * every reload starts signed out; without this, `_app` would bounce a
 * signed-in user to /login. ensureSession() dedupes concurrent callers and
 * signs the store out on an auth verdict, so this only starts the cross-tab
 * logout listener and the analytics identity subscription, and flips
 * isBootstrapped, whether or not the refresh worked. A restore that ends with
 * no user also drops any person posthog-js still holds from an earlier visit
 * (`forgetStaleIdentity`), before the first page view: whoever is at the
 * browser now is not known to be them. After a failure that judged nothing
 * (a 502, say) the person is kept if another open tab answers that it is
 * signed in as them, so that tab's replay is not split.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  installAuthBroadcastListener()
  installAnalyticsIdentity(queryClient)
  let isVerdict = false
  try {
    await ensureSession()
  } catch (error) {
    // Any refresh failure leaves this load signed out; only an auth verdict also clears the store (see refreshSession).
    isVerdict = isAuthVerdict(error)
  } finally {
    if (!useAuthStore.getState().user) {
      forgetStaleIdentity({ keepIfAnotherTabHoldsThem: !isVerdict })
    }
    useAuthStore.getState().setBootstrapped()
  }
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  /** Imported statically: when a chunk cannot be fetched, a lazy error screen could not load either. */
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  defaultPendingComponent: RoutePending,
  /** Held back 300ms so a fast navigation never flashes it, then kept 300ms so it never blinks. */
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
})

installRouteAnalytics(router)
installFlagScopeReset(router, queryClient)
installRouteFeatureProperties(router, queryClient)
setErrorRouteSource(() => router.state.matches.at(-1)?.routeId)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }

  /**
   * A route's breadcrumb label, declared on the route so that dynamic routes
   * (`/tenants/$slug` resolves to `/tenants/acme`) describe themselves. A
   * function receives the match's path params, so a detail route can name
   * itself after what it shows.
   */
  interface StaticDataRouteOption {
    crumb?: string | ((params: Record<string, string>) => string)
  }
}
