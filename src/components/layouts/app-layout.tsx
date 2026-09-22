import { Link, Outlet, useMatches } from '@tanstack/react-router'
import { LayoutDashboard } from 'lucide-react'
import { Fragment, useEffect } from 'react'
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
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'

/**
 * The sidebar's primary navigation.
 *
 * Only the routes that EXIST carry an entry: `to` is typed against the
 * generated route tree, so listing `/notifications` or `/tenants` before their
 * route files land is a type error, not a dead link.
 *
 * Task 7 adds `{ to: ROUTES.notifications, label: 'Notifications', Icon: Bell }`.
 * Task 8 adds `{ to: ROUTES.tenants, label: 'Tenants', Icon: Building2 }`.
 */
const NAV_ITEMS = [{ to: ROUTES.dashboard, label: 'Dashboard', Icon: LayoutDashboard }] as const

/**
 * Breadcrumb labels, keyed by the pathname the router reports for a match.
 *
 * Kept as literal `to` values rather than a `Record<string, string>` so an
 * ancestor crumb can be rendered as a typed `<Link>` when nesting arrives.
 * Task 7 and Task 8 append their own entries here.
 */
const CRUMBS = [
  { to: ROUTES.dashboard, label: 'Dashboard' },
  { to: ROUTES.profile, label: 'Profile' },
] as const

type Crumb = (typeof CRUMBS)[number]

/**
 * The trail for the current location, in route order.
 *
 * Pathless layout matches (`__root__`, `/_app`) report a pathname of `/`,
 * which matches no entry, so they drop out without a special case.
 */
function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  return matches
    .map((match) => CRUMBS.find((crumb) => crumb.to === match.pathname.replace(/\/+$/, '')))
    .filter((crumb) => crumb !== undefined)
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const crumbs = useBreadcrumbs()
  const activePath = crumbs.at(-1)?.to

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
  // (Same rule, different subject: Task 7's SSE hook belongs in the header
  // slot for exactly this reason. In the sidebar footer it would be live on
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
          {/* TenantSwitcher slot — Task 8 fills this. Left empty rather than
              stubbed so that task adds a component instead of deleting one. */}
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
                  <SidebarMenuButton isActive={activePath === to} render={<Link to={to} />}>
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
          {/* A sibling of the user menu, not an item inside it. The listener
              that makes `theme: 'system'` follow the OS lives in ThemeToggle,
              and inside a dropdown it would unmount every time the menu
              closed — so it has to be mounted by the layout itself. */}
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
                <Fragment key={crumb.to}>
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
            {/* NotificationBell slot — Task 7 fills this and mounts the SSE
                hook. Left empty for the same reason as the header slot. */}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
