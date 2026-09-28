import { Link, Outlet, useLocation, useMatches, type LinkProps } from '@tanstack/react-router'
import { Bell, Building2, LayoutDashboard } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { NotificationBell } from '@/components/features/notification-bell'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { TenantSwitcher } from '@/components/features/tenant-switcher'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { UserMenu } from '@/components/features/user-menu'
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { useNotificationStream } from '@/hooks/use-notifications'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'

/** The sidebar's primary navigation. `to` is typed against the route tree, so a missing route is a type error. */
const NAV_ITEMS = [
  { to: ROUTES.dashboard, label: 'Dashboard', Icon: LayoutDashboard },
  { to: ROUTES.notifications, label: 'Notifications', Icon: Bell },
  { to: ROUTES.tenants, label: 'Tenants', Icon: Building2 },
] as const

interface Crumb {
  /** Stable across renders: one crumb per matched route. */
  key: string
  label: string
  /** The resolved path of that match: `/tenants/acme`, not `/tenants/$slug`. */
  to: LinkProps['to']
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
      },
    ]
  })
  return withAncestors(matched)
}

/**
 * List pages a detail page sits under in the reader's mind but not in the
 * route tree: `/tenants` and `/tenants/$slug` are siblings, so without this
 * the trail would jump straight to `acme / Members`.
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
        trail.push({ key: ancestor.to, label: ancestor.label, to: ancestor.to })
      }
    }
    trail.push(crumb)
  }
  return trail
}

/** Whether a nav item's route contains the current location. */
function isNavActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * The signed-in shell: sidebar, header with breadcrumbs, and the page.
 *
 * It holds the one mount of the notification stream and the listener that
 * makes `theme: 'system'` follow the OS (the theme store samples
 * `prefers-color-scheme` once, at import). Both live here, not in the sidebar:
 * below `md` the `Sidebar` renders into a `Sheet`, whose content unmounts
 * while the drawer is closed, so anything inside it would be dead on phones.
 * The theme toggle is a sibling of the user menu for the same reason: inside
 * the dropdown it would unmount whenever the menu closed.
 *
 * The primary navigation sits in its own `nav` landmark, since `Sidebar`
 * renders plain divs, and each item renders as the anchor itself, so it is
 * keyboard-reachable and opens in a new tab. `SidebarInset` is the `main`
 * element, so the page goes in a plain div. The trigger's explicit aria-label
 * pins its name against a re-added vendored file. Each breadcrumb separator
 * is a sibling `li`, since an `li` inside an `li` is invalid. The nav
 * highlight reads the location, not the last crumb, whose deep path matches
 * no nav item. The sidebar store, not the provider, owns the open state, so
 * anything in the app can read or set it.
 */
export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const crumbs = useBreadcrumbs()
  const pathname = useLocation({ select: (location) => location.pathname })

  useNotificationStream()

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
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
          <nav aria-label="Main">
            <SidebarMenu>
              {NAV_ITEMS.map(({ to, label, Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton isActive={isNavActive(pathname, to)} render={<Link to={to} />}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <UserMenu user={user} />
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.key}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
