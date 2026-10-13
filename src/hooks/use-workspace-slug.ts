import { useParams } from '@tanstack/react-router'
import { useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

/**
 * The tenant Settings › Workspace acts on: the route's `$slug` when the page
 * has one, otherwise the last tenant this user opened, but only while it is
 * still one of their active, non-platform memberships, so the nav never links
 * a tenant they left, were removed from, or that staff suspended. Null when
 * there is none; the settings nav then asks to choose a tenant first.
 */
export function useWorkspaceSlug(): string | null {
  const { slug } = useParams({ strict: false })
  const userId = useAuthStore((s) => s.user?.id)
  const fromStore = useCurrentTenantStore((s) => (userId ? s.remembered[userId] : undefined))
  const tenants = useTenants()
  if (slug) return slug
  if (!userId) return null
  const remembered = fromStore ?? readRememberedTenant(userId)
  if (!remembered) return null
  const listed = tenants.data?.find((entry) => entry.tenant.slug === remembered)
  return listed && !listed.isPlatform && listed.tenant.lifecycleState !== 'suspended'
    ? remembered
    : null
}
