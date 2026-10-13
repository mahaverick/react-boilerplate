/**
 * @file The current tenant in the URL. A tenant page carries it in its `$slug`
 * path segment; every other page in the signed-in shell carries it as
 * `?tenant=<slug>`. `_app` owns the param: this module holds its schema, the
 * search middleware that keeps it on every navigation, and the guard that fills
 * or corrects it.
 */
import type { QueryClient } from '@tanstack/react-query'
import {
  stripSearchParams,
  type AnyRouter,
  type ParsedLocation,
  type SearchMiddleware,
} from '@tanstack/react-router'
import { z } from 'zod'
import { tenantsQueryOptions, type TenantWithRole } from '@/queries/tenant.queries'
import { slugSchema } from '@/schemas/tenant.schemas'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

/** `_app`'s search params: the current tenant on a page without `$slug`. */
export interface TenantSearch {
  tenant?: string
}

/**
 * `_app`'s `validateSearch`. `tenant` is a slug as express's pattern allows it,
 * unchanged by trimming; anything else is caught as `undefined`, so a bad value
 * never throws into the error screen. The guard then replaces it.
 */
export const tenantSearchSchema = z.object({
  tenant: z
    .string()
    .refine((value) => slugSchema.safeParse(value).data === value)
    .optional()
    .catch(undefined),
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
 * The tenant `location` names: its `$slug`, else its `?tenant` when that is a
 * string. Read before the location loads, so it is not yet validated; the
 * guard corrects it on a page without `$slug`.
 */
function tenantOf(router: AnyRouter, location: ParsedLocation): string | null {
  const [, params] = router.getMatchedRoutes(location.pathname)
  if (params.slug) return params.slug
  const { tenant } = location.search as Record<string, unknown>
  return typeof tenant === 'string' && tenant !== '' ? tenant : null
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

/** Whether the user may work in a listed tenant: not the platform tenant, and not suspended. */
function isEligible(entry: TenantWithRole): boolean {
  return !entry.isPlatform && entry.tenant.lifecycleState !== 'suspended'
}

/**
 * The tenant a page without `$slug` shows: `requested` when it is eligible,
 * else the remembered tenant when that is, else the first eligible tenant in
 * list order. Null when the user has none.
 * @param list - The caller's `GET /tenants` rows.
 * @param requested - The URL's `?tenant`.
 * @param remembered - The slug last remembered for this user.
 * @returns The slug, or null.
 */
export function resolveTenant(
  list: readonly TenantWithRole[],
  requested: string | undefined,
  remembered: string | null
): string | null {
  const eligible = list.filter(isEligible).map((entry) => entry.tenant.slug)
  if (requested !== undefined && eligible.includes(requested)) return requested
  if (remembered !== null && eligible.includes(remembered)) return remembered
  return eligible[0] ?? null
}

/** What `_app`'s `beforeLoad` hands `tenantSearchCorrection`. */
interface TenantGuardInput {
  queryClient: QueryClient
  location: ParsedLocation
  params: { slug?: string }
  search: TenantSearch
  preload: boolean
}

/** The `?tenant` a page must redirect to; `undefined` removes it. */
interface TenantCorrection {
  tenant: string | undefined
}

/**
 * `_app`'s tenant guard, run after its auth guard; `_app` redirects to the
 * correction, which replaces the entry. A `$slug` page drops any `?tenant`.
 * Any other page resolves its tenant (`resolveTenant`) from the cached tenant
 * list and is corrected when the URL's value differs: missing, invalid or not
 * eligible. The resolved tenant is remembered for the user. A list that cannot
 * be loaded leaves the URL as it is: a failed list never bounces or blocks the
 * page. A hover preload is never corrected and remembers nothing.
 * @param input - The `beforeLoad` arguments it reads.
 * @returns The correction, or null to leave the URL as it is.
 */
export async function tenantSearchCorrection({
  queryClient,
  location,
  params,
  search,
  preload,
}: TenantGuardInput): Promise<TenantCorrection | null> {
  const raw = (location.search as Record<string, unknown>).tenant
  if (params.slug !== undefined) {
    return raw !== undefined && !preload ? { tenant: undefined } : null
  }
  let list: TenantWithRole[]
  try {
    // retry: false, so a failing list renders the page at once rather than after a retry's back-off.
    list = await queryClient.ensureQueryData({ ...tenantsQueryOptions(), retry: false })
  } catch {
    return null
  }
  if (preload) return null
  const userId = useAuthStore.getState().user?.id
  const remembered = userId
    ? (useCurrentTenantStore.getState().remembered[userId] ?? readRememberedTenant(userId))
    : null
  const resolved = resolveTenant(list, search.tenant, remembered)
  if (resolved !== null && userId && resolved !== remembered) {
    useCurrentTenantStore.getState().remember(userId, resolved)
  }
  return raw === (resolved ?? undefined) ? null : { tenant: resolved ?? undefined }
}
