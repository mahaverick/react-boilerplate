import { IconBuilding, IconLayoutDashboard } from '@tabler/icons-react'
import { Link, Outlet, useLocation, useMatches, type LinkProps } from '@tanstack/react-router'
import { Fragment, useEffect } from 'react'
import { MaintenanceBanner } from '@/components/features/maintenance/maintenance-gate'
import { NotificationBell } from '@/components/features/notification-bell'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { TenantSwitcher } from '@/components/features/tenant-switcher'
import { TenantSearchGuard } from '@/components/features/tenant/tenant-search-guard'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { UserMenu } from '@/components/features/user-menu'
import { NavMain, type NavMainItem } from '@/components/layouts/nav-main'
import { NavSecondary } from '@/components/layouts/nav-secondary'
import { NavSettings } from '@/components/layouts/nav-settings'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { isSettingsPath } from '@/constants/settings'
import { useNotificationStream } from '@/hooks/use-notifications'
import { useFeaturePropertiesSync, useFlagValues } from '@/observability/flags/flag-hooks'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-types'
import { filterByFlag } from '@/observability/flags/flag-values'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'

/**
 * One sidebar entry. `flag` hides it while that flag is off; the sidebar has
 * no tenant, so only a user-scoped flag belongs here (a tenant-scoped one
 * gates a tenant tab instead). An entry with `items` renders as a
 * collapsible group.
 */
interface NavItem extends NavMainItem {
  flag?: BooleanClientFlagKey
}

/** The sidebar's primary navigation. `to` is typed against the route tree, so a missing route is a type error. */
const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.dashboard, label: 'Dashboard', Icon: IconLayoutDashboard },
  { to: ROUTES.tenants, label: 'Tenants', Icon: IconBuilding },
]

/** One breadcrumb link: the page's label and the path it opens. */
interface Crumb {
  /** Stable across renders: one crumb per matched route. */
  key: string
  label: string
  /** The resolved path of that match: `/tenants/acme`, not `/tenants/$slug`. */
  to: LinkProps['to']
  /** False when the match's path only redirects, so the crumb renders as text. */
  link: boolean
}

/**
 * The trail for the current location, in route order, read off each match's
 * `staticData.crumb` (see the augmentation in `@/router`). Pathless layout
 * matches (`__root__`, `/_app`) declare no crumb and drop out. An index
 * match's trailing slash is trimmed, so `/tenants/` and the nav's `/tenants`
 * are one href.
 */
function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  const matched = matches.flatMap((match) => {
    const crumb = match.staticData.crumb
    if (crumb === undefined) return []
    const params = match.params as Record<string, string>
    const path = match.pathname.replace(/(.)\/+$/, '$1')
    return [
      {
        key: match.routeId,
        label: typeof crumb === 'function' ? crumb(params) : crumb,
        to: path as LinkProps['to'],
        link: match.staticData.crumbLink !== false,
      },
    ]
  })
  return withAncestors(matched)
}

/**
 * List pages a detail page sits under in the reader's mind but not in the
 * route tree: `/tenants` and `/tenants/$slug` are siblings, so without this
 * the trail would jump straight to `acme / Overview`.
 */
const ANCESTOR_CRUMBS = [{ to: ROUTES.tenants, label: 'Tenants' }] as const

/**
 * Insert each missing ancestor immediately before the first crumb under it.
 * Matched on `${ancestor}/`, so the list page itself gets no duplicate.
 */
function withAncestors(crumbs: Crumb[]): Crumb[] {
  const trail: Crumb[] = []
  for (const crumb of crumbs) {
    for (const ancestor of ANCESTOR_CRUMBS) {
      const isDescendant = typeof crumb.to === 'string' && crumb.to.startsWith(`${ancestor.to}/`)
      if (isDescendant && !trail.some((existing) => existing.to === ancestor.to)) {
        trail.push({ key: ancestor.to, label: ancestor.label, to: ancestor.to, link: true })
      }
    }
    trail.push(crumb)
  }
  return trail
}

/**
 * The signed-in shell, after shadcn's sidebar-07 block: a sidebar that
 * collapses to icons (with a rail to toggle it), a header with breadcrumbs,
 * and the page. The sidebar holds the tenant switcher, the primary
 * navigation (`NavMain`) with a bottom group (`NavSecondary`), and the account
 * menu. On settings pages the sidebar's content swaps to `NavSettings`, after
 * Pulse; the header slot and account menu never change.
 *
 * It holds the one mount of the notification stream, of the `$feature/*`
 * super-property sync (`useFeaturePropertiesSync`), and of the listener that
 * makes `theme: 'system'` follow the OS: it calls `setTheme('system')` on each
 * `prefers-color-scheme` change, and the theme store samples that setting on
 * each `setTheme`. All three live here, not in the sidebar: below `md` the
 * `Sidebar` renders into a `Sheet`, whose content unmounts while the drawer is
 * closed, so anything inside it would be dead on phones. The theme toggle sits
 * in the header beside the notification bell, so it is reachable on phones
 * without opening the drawer, and is not an item in the account menu, which
 * unmounts its content whenever the menu closes.
 *
 * `SidebarInset` is the `main` element, so the page goes in a plain div. The
 * trigger's explicit aria-label pins its name against a re-added vendored
 * file. Each breadcrumb separator is a sibling `li`, since an `li` inside an
 * `li` is invalid. The nav highlight reads the location, not the last crumb,
 * whose deep path matches no nav item. The sidebar store, not the provider,
 * owns the open state, so anything in the app can read or set it.
 * `MaintenanceBanner` sits under the header, inside the content column, so the
 * fixed sidebar never covers it; the maintenance gate draws it only for pages
 * outside this shell. The page slot sits under `TenantSearchGuard`, which
 * settles `?tenant` before a page without `$slug` renders.
 */
export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const crumbs = useBreadcrumbs()
  const pathname = useLocation({ select: (location) => location.pathname })
  const navItems = filterByFlag(NAV_ITEMS, useFlagValues())

  useNotificationStream()
  useFeaturePropertiesSync()

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    /** Re-applies the `system` theme so the document class follows the OS. */
    const onChange = () => setTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return (
    <SidebarProvider open={!isCollapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <SkipLink />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <TenantSwitcher />
        </SidebarHeader>
        <SidebarContent>
          {isSettingsPath(pathname) ? (
            <NavSettings pathname={pathname} />
          ) : (
            <>
              <NavMain items={navItems} pathname={pathname} />
              <NavSecondary pathname={pathname} className="mt-auto" />
            </>
          )}
        </SidebarContent>
        <SidebarFooter>
          <UserMenu user={user} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger aria-label="Toggle sidebar" className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.key}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : crumb.link ? (
                      <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>
        <MaintenanceBanner />
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <TenantSearchGuard>
            <Outlet />
          </TenantSearchGuard>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
