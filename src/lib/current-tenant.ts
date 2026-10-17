/**
 * @file The current tenant in the URL. A tenant page carries it in its `$slug`
 * path segment; every other page in the signed-in shell carries it as
 * `?tenant=<slug>`. `_app` owns the param: this module holds its schema and
 * the search middleware that keeps it on every navigation; the guard that fills
 * or corrects it is `TenantSearchGuard`, in the `_app` layout.
 */
import '@/lib/zod-jitless'
import {
  stripSearchParams,
  type AnyRouter,
  type ParsedLocation,
  type SearchMiddleware,
} from '@tanstack/react-router'
import { z } from 'zod'
import { isSlugShaped } from '@/schemas/slug.schemas'

/** `_app`'s search params: the current tenant on a page without `$slug`. */
export interface TenantSearch {
  tenant?: string
}

/**
 * `_app`'s `validateSearch`. `tenant` is a slug as express's pattern allows it;
 * anything else is caught as `undefined`, so a bad value never throws into the
 * error screen. The guard then replaces it.
 */
export const tenantSearchSchema = z.object({
  tenant: z.string().refine(isSlugShaped).optional().catch(undefined),
})

/** The tenant of the page the router is on or moving to: its `$slug`, else its `?tenant`. */
let currentTenant: string | null = null

/** The `next` of a search middleware, called with `collectMeta` as `retainSearchParams` does. */
type NextWithMeta = (
  search: TenantSearch,
  collectMeta: true
) => { search: TenantSearch; meta: { removedAny?: Set<string> } }

/**
 * `_app`'s search middleware: every navigation inside the shell keeps the
 * current tenant, as `retainSearchParams(['tenant'])` would, except that the
 * value comes from the current page's `?tenant` or, on a `$slug` page whose
 * URL has none, from its slug. A navigation that names `tenant` itself wins,
 * `undefined` included, and a destination that strips it (a `$slug` route's
 * `stripTenant`) keeps it off.
 */
export const retainTenant: SearchMiddleware<TenantSearch> = ({ search, next }) => {
  const { search: result, meta } = (next as unknown as NextWithMeta)(search, true)
  const tenant = search.tenant ?? currentTenant
  if (!tenant || 'tenant' in result || meta.removedAny?.has('tenant')) return result
  return { ...result, tenant }
}

/**
 * The `$slug` layouts' search middleware: their tenant is the path, so a link
 * to one never carries `?tenant`. Without it, `retainTenant` would add the
 * previous page's tenant and the guard would redirect it away.
 */
export const stripTenant: SearchMiddleware<TenantSearch> = stripSearchParams<TenantSearch>([
  'tenant',
])

/**
 * The tenant `location` names: its `$slug`, else its `?tenant` when that has
 * a slug's shape. Read before the location loads, so it is not yet validated; the
 * guard corrects it on a page without `$slug`.
 */
function tenantOf(router: AnyRouter, location: ParsedLocation): string | null {
  const [, params] = router.getMatchedRoutes(location.pathname)
  if (params.slug) return params.slug
  const { tenant } = location.search as Record<string, unknown>
  return typeof tenant === 'string' && isSlugShaped(tenant) ? tenant : null
}

/**
 * Records the tenant of each location the router starts loading, for
 * `retainTenant`. On `onBeforeLoad`, before the router publishes the new
 * location, so a link that renders for it (the sidebar's, say) builds its
 * href from this page's tenant, not the previous one's. A page outside the
 * shell names none, so nothing carries across a sign-out.
 * @param router - The app's router.
 * @returns The unsubscribe, which also forgets the recorded tenant.
 */
export function installCurrentTenant(router: AnyRouter): () => void {
  currentTenant = null
  const unsubscribe = router.subscribe('onBeforeLoad', ({ toLocation }) => {
    currentTenant = tenantOf(router, toLocation)
  })
  return () => {
    unsubscribe()
    currentTenant = null
  }
}
