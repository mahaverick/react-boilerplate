/**
 * @file `_app`'s tenant guard, loaded on demand by its `beforeLoad` so the
 * tenant list's query and the stores stay out of the entry chunk. How the
 * tenant is carried is in `current-tenant.ts`.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { ParsedLocation } from '@tanstack/react-router'
import type { TenantSearch } from '@/lib/current-tenant'
import { tenantsQueryOptions, type TenantWithRole } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

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
