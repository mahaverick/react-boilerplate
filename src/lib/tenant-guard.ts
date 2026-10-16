/**
 * @file The current tenant's resolution for a page without `$slug`: which
 * tenant `?tenant` should name, given the caller's tenant list. Pure, so the
 * `_app` layout's guard (`TenantSearchGuard`) decides and remembers. How the
 * tenant is carried is in `current-tenant.ts`.
 */
import { isEligibleTenant, type TenantWithRole } from '@/queries/tenant.queries'

/**
 * The tenant a page without `$slug` shows: `requested` when it is eligible,
 * else the remembered tenant when that is, else the first eligible tenant in
 * list order. Null when the user has none.
 * @param list - The caller's `GET /tenants` rows.
 * @param requested - The URL's validated `?tenant`.
 * @param remembered - The slug last remembered for this user.
 * @returns The slug, or null.
 */
function resolveTenant(
  list: readonly TenantWithRole[],
  requested: string | undefined,
  remembered: string | null
): string | null {
  const eligible = list.filter(isEligibleTenant).map((entry) => entry.tenant.slug)
  if (requested !== undefined && eligible.includes(requested)) return requested
  if (remembered !== null && eligible.includes(remembered)) return remembered
  return eligible[0] ?? null
}

/** What `correctTenant` reads. */
interface TenantGuardInput {
  list: readonly TenantWithRole[]
  /** The URL's `?tenant` as written, before validation: a bad value must be replaced too. */
  raw: unknown
  requested: string | undefined
  remembered: string | null
}

/** The `?tenant` a page must move to; `undefined` removes it. */
interface TenantCorrection {
  tenant: string | undefined
}

/**
 * The correction a page without `$slug` needs: none when the URL already
 * names the resolved tenant (or names none and there is none).
 * @param input - The list, the URL's raw and validated values, and the remembered slug.
 * @returns The resolved slug (null for none) and the correction (null to leave the URL as it is).
 */
export function correctTenant({ list, raw, requested, remembered }: TenantGuardInput): {
  resolved: string | null
  correction: TenantCorrection | null
} {
  const resolved = resolveTenant(list, requested, remembered)
  return {
    resolved,
    correction: raw === (resolved ?? undefined) ? null : { tenant: resolved ?? undefined },
  }
}
