import { useEffect } from 'react'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { isEligibleTenant, useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Records the current tenant in the palette's recents whenever it changes to
 * one the caller may work in, under the name the switcher shows. Mounted
 * once, in the signed-in shell.
 */
export function useRecordRecentTenant(): void {
  const userId = useAuthStore((state) => state.user?.id)
  const slug = useCurrentTenantSlug()
  const tenants = useTenants()
  const entry = tenants.data?.find((row) => row.tenant.slug === slug)
  const listed = entry !== undefined && isEligibleTenant(entry)
  const id = listed ? entry.tenant.id : undefined
  const name = listed ? entry.tenant.name : undefined
  useEffect(() => {
    if (userId && id && name) recordRecent(userId, { kind: 'tenant', id, label: name })
  }, [userId, id, name])
}
