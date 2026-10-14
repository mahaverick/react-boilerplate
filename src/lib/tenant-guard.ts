/**
 * @file `_app`'s tenant guard, loaded on demand by its `beforeLoad` so the
 * tenant list's query and the stores stay out of the entry chunk. How the
 * tenant is carried is in `current-tenant.ts`.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { ParsedLocation } from '@tanstack/react-router'
import { armTenantGuardRerun, type TenantSearch } from '@/lib/current-tenant'
import {
  isEligibleTenant,
  tenantKeys,
  tenantsQueryOptions,
  type TenantWithRole,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

/**
 * The longest the guard waits for the tenant list before it lets the page
 * render with the URL as it is. The read stays in flight for the shell's
 * `useTenants`, and `rerunWhenListLoads` corrects the URL when it lands.
 */
export const TENANT_LIST_WAIT_MS = 3_000

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
  const eligible = list.filter(isEligibleTenant).map((entry) => entry.tenant.slug)
  if (requested !== undefined && eligible.includes(requested)) return requested
  if (remembered !== null && eligible.includes(remembered)) return remembered
  return eligible[0] ?? null
}

/**
 * `promise`'s value, or null when it rejects or has not settled within `ms`.
 * The timer is cleared as soon as either happens.
 * @param promise - The read to wait for.
 * @param ms - The longest wait.
 * @returns The value, or null.
 */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
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
 * Arms a re-run of the guard (`armTenantGuardRerun`) for the first time the
 * tenant list query holds data, whether the guard's own read lands late or the
 * shell's `useTenants` retries a failed one.
 * @param queryClient - The client holding the tenant list.
 */
function rerunWhenListLoads(queryClient: QueryClient): void {
  armTenantGuardRerun((rerun) =>
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryHash !== listHash()) return
      if (event.query.state.status === 'success') rerun()
    })
  )
}

/** The tenant list query's hash, as the query cache keys it. */
function listHash(): string {
  return JSON.stringify(tenantKeys.list)
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
 * eligible. The resolved tenant is remembered for the user. A list that fails,
 * or takes longer than `TENANT_LIST_WAIT_MS`, leaves the URL as it is, so it
 * never bounces the page or holds it for long; the guard runs again once the
 * list loads. A hover preload is never corrected and remembers nothing.
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
  // retry: false, so a failing list renders the page at once rather than after a retry's back-off.
  const list = await within(
    queryClient.ensureQueryData({ ...tenantsQueryOptions(), retry: false }),
    TENANT_LIST_WAIT_MS
  )
  if (list === null) {
    if (!preload) rerunWhenListLoads(queryClient)
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
