import { useParams, useSearch } from '@tanstack/react-router'

/**
 * The current tenant, read from the URL alone: the route's `$slug` on a tenant
 * page, else the shell's `?tenant`, which `_app`'s guard keeps to an eligible
 * tenant. Null when the URL names none; the switcher then asks to choose a
 * tenant and Settings › Workspace is disabled. Read the current tenant here,
 * never from `current-tenant.store`, which is only the guard's fallback.
 */
export function useCurrentTenantSlug(): string | null {
  const { slug } = useParams({ strict: false })
  const tenant = useSearch({ strict: false, select: (search) => search.tenant })
  return slug ?? tenant ?? null
}
