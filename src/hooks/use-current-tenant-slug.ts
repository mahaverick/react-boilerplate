import { useParams, useSearch } from '@tanstack/react-router'
import { isEligibleTenant, useTenants } from '@/queries/tenant.queries'

/**
 * The current tenant, read from the URL: the route's `$slug` on a tenant page,
 * else the shell's `?tenant`, which `_app`'s guard keeps to an eligible
 * tenant. A `?tenant` the loaded tenant list lacks, or lists as ineligible, is
 * null, so a URL the guard could not correct (a failed or late list) never
 * enables the Workspace links; while the list loads, the URL is trusted.
 * Null when the URL names none; the switcher then asks to choose a tenant and
 * Settings › Workspace is disabled. Read the current tenant here, never from
 * `current-tenant.store`, which is only the guard's fallback.
 */
export function useCurrentTenantSlug(): string | null {
  const { slug } = useParams({ strict: false })
  const tenant = useSearch({ strict: false, select: (search) => search.tenant })
  const tenants = useTenants()
  if (slug) return slug
  if (!tenant) return null
  if (!tenants.data) return tenant
  const listed = tenants.data.find((entry) => entry.tenant.slug === tenant)
  return listed && isEligibleTenant(listed) ? tenant : null
}
