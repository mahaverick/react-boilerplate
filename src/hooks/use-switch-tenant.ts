import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { settingsActiveSection } from '@/constants/settings'

/**
 * Opens another tenant the way the tenant switcher does: on a workspace
 * settings page, the same section for that tenant; on another `$slug` page,
 * `/tenants/$slug`; on any other page, the same page with `?tenant` changed
 * (a push, so Back returns to the previous tenant). The switcher and the
 * command palette both call it.
 * @returns The switch, taking the chosen tenant's slug.
 */
export function useSwitchTenant(): (slug: string) => void {
  const navigate = useNavigate()
  const { slug: routeSlug } = useParams({ strict: false })
  const pathname = useLocation({ select: (location) => location.pathname })
  const section = settingsActiveSection(pathname)
  return (slug) => {
    if (section?.group === 'workspace') {
      void navigate({ to: section.to, params: { slug } })
    } else if (routeSlug !== undefined) {
      void navigate({ to: '/tenants/$slug', params: { slug } })
    } else {
      void navigate({ to: '.', search: (prev) => ({ ...prev, tenant: slug }) })
    }
  }
}
