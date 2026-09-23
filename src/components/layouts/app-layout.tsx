import { Link, Outlet, useLocation, useMatches, type LinkProps } from '@tanstack/react-router'
import { Bell, Building2, LayoutDashboard } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { NotificationBell } from '@/components/features/notification-bell'
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

/**
 * The sidebar's primary navigation.
 *
 * Only the routes that EXIST carry an entry: `to` is typed against the
 * generated route tree, so listing `/notifications` or `/tenants` before their
 * route files land is a type error, not a dead link.
 */
const NAV_ITEMS = [
  { to: ROUTES.dashboard, label: 'Dashboard', Icon: LayoutDashboard },
  { to: ROUTES.notifications, label: 'Notifications', Icon: Bell },
  { to: ROUTES.tenants, label: 'Tenants', Icon: Building2 },
] as const

interface Crumb {
  /** Stable across renders: one crumb per matched route. */
  key: string
  label: string
  /** The RESOLVED path of that match — `/tenants/acme`, not `/tenants/$slug`. */
  to: LinkProps['to']
}

/**
 * The trail for the current location, in route order.
 *
 * Read off each match's `staticData.crumb` (see the augmentation in
 * `@/router`), NOT by matching a literal path. The table this replaced could
 * not describe a dynamic route at all: `/tenants/$slug` resolves to
 * `/tenants/acme`, which equals no literal `to`, and `/tenants` is a SIBLING
 * of it rather than an ancestor, so no parent match covered for it either —
 * every tenant detail page rendered an empty breadcrumb bar.
 *
 * Pathless layout matches (`__root__`, `/_app`) declare no crumb and drop out
 * without a special case, exactly as they did before.
 */
function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  const matched = matches.flatMap((match) => {
    const crumb = match.staticData.crumb
    if (crumb === undefined) return []
    const params = match.params as Record<string, string>
    // The trailing slash an index match reports would make `/tenants/` a
    // different href from the `/tenants` the nav links to.
    const path = match.pathname.replace(/(.)\/+$/, '$1')
    return [
      {
        key: match.routeId,
        label: typeof crumb === 'function' ? crumb(params) : crumb,
        // `pathname` is a resolved string; `to` is a union of route patterns.
        // The router navigates by the string either way — this assertion is
        // about the type, not about what is being linked to.
        to: path as LinkProps['to'],
      },
    ]
  })
  return withAncestors(matched)
}

/**
 * List pages that a detail page sits UNDER in the reader's mind but not in the
 * route tree.
 *
 * `/tenants` and `/tenants/$slug` are siblings — the detail route is not
 * nested inside the list route — so no match ever produces a "Tenants" crumb
 * on a tenant page, and the trail would jump straight to `acme / Members`.
 * Synthesised here rather than fixed by restructuring the route files, which
 * would churn files three other tasks have already touched for the sake of a
 * cosmetic trail.
 */
const ANCESTOR_CRUMBS = [{ to: ROUTES.tenants, label: 'Tenants' }] as const

/**
 * Insert each missing ancestor immediately before the first crumb that lives
 * underneath it.
 *
 * Path-prefixed on `${ancestor}/`, so the list page itself — whose own crumb
 * IS `/tenants` — never gets a duplicate of itself in front of it.
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

export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const crumbs = useBreadcrumbs()
  // Read from the location, not from the last crumb: `/tenants/acme/members`
  // ends on a crumb whose `to` is that same deep path, which would light no
  // nav item at all.
  const pathname = useLocation({ select: (location) => location.pathname })

  // The ONE mount of the notification stream, and it belongs here for the
  // same reason the theme listener below does — see that comment. A single
  // fetch-based SSE connection per session: mounting this in NotificationBell
  // or on the notifications page instead would open a second connection, and
  // mounting it anywhere inside `Sidebar` would leave it live on desktop and
  // silently dead on every phone, with nothing in any log to say so.
  useNotificationStream()

  // `theme: 'system'` has to mean "follow the OS", not "whatever the OS was
  // when this tab loaded": the theme store samples `prefers-color-scheme` once,
  // at import, and it is not a React component so it cannot own an effect.
  //
  // This lives HERE, one level up from the ThemeToggle control it serves, and
  // that is deliberate — do not "tidy" it back down. Below `md` the whole
  // `Sidebar` renders into a `Sheet`, which is a Base UI `Dialog.Popup` with no
  // `keepMounted`, so everything in the sidebar — ThemeToggle and UserMenu
  // included — UNMOUNTS whenever the drawer is closed. An effect in ThemeToggle
  // therefore stops existing on a phone, and the OS switching to dark does
  // nothing until the next reload. AppLayout renders `SidebarInset` and the
  // header on both viewports, so it is the lowest component that is genuinely
  // mounted for the whole authenticated session.
  //
  // (Same rule, different subject: `useNotificationStream()` above is mounted
  // here for exactly this reason. In the sidebar footer it would be live on
  // desktop and silently dead on mobile.)
  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    // Re-applied through setTheme('system') rather than by toggling the class
    // directly, so the store stays the single owner of that decision.
    const onChange = () => setTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return (
    // The store owns the open/closed state rather than the provider's own
    // useState, so anything else in the app can read or set it.
    <SidebarProvider open={!isCollapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <TenantSwitcher />
        </SidebarHeader>
        <SidebarContent>
          {/* A real `nav` landmark: `Sidebar` renders plain divs, so without
              this the primary navigation sits in no landmark at all. */}
          <nav aria-label="Main">
            <SidebarMenu>
              {NAV_ITEMS.map(({ to, label, Icon }) => (
                <SidebarMenuItem key={to}>
                  {/* `render` is Base UI's `asChild`: the button IS the
                      anchor, so the nav item is keyboard-reachable and
                      openable in a new tab — not a click handler on a div. */}
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
          {/* A sibling of the user menu, not an item inside it: inside a
              dropdown this control would unmount every time the menu closed.
              The listener that makes `theme: 'system'` follow the OS is NOT
              in here — it is the effect above, in this component, for the
              reason given there and repeated in theme-toggle.tsx. */}
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
      {/* SidebarInset IS a `<main>` element (see components/ui/sidebar.tsx).
          The page content therefore goes in a plain div: a second `<main>`
          nested inside it would give every page two main landmarks, which is
          an axe `landmark-no-duplicate-main` failure in Task 9. */}
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          {/* The vendored trigger already carries a visually hidden "Toggle
              Sidebar"; the explicit aria-label pins the name so a future
              `shadcn add sidebar` cannot quietly remove it. */}
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                // The separator is a SIBLING `li`, not a child of the item:
                // BreadcrumbSeparator renders an `<li>` and an `<li>` inside
                // an `<li>` is invalid markup.
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
