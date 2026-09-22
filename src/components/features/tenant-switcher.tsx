import { Link, useParams } from '@tanstack/react-router'
import { Building2, ChevronsUpDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { useTenants } from '@/queries/tenant.queries'

/**
 * A NAVIGATION dropdown, and nothing else.
 *
 * Tenant scope is the URL: every tenant-scoped route resolves its tenant from
 * the `:slug` path param. The API reserves an `X-Tenant-Id` header, but
 * `tenant.middleware.ts` marks it "reserved for a future" and no route reads
 * it — so a switcher that set that header, or wrote a "current tenant" to a
 * store, would be a silent no-op that looked like it worked. Each item is a
 * link to `/tenants/$slug`; the current tenant is whatever the URL says.
 */
export function TenantSwitcher() {
  const tenants = useTenants()
  // `strict: false` because this renders in the app shell, on every
  // authenticated route — most of which have no `$slug` at all.
  const { slug } = useParams({ strict: false })
  const current = tenants.data?.find((entry) => entry.tenant.slug === slug)
  const label = current?.tenant.name ?? 'Tenants'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          {/* Every piece of text here lives INSIDE the trigger button. A bare
              `<p>Acme Corp</p>` in the SidebarHeader would be content sitting
              in no landmark, which axe's `region` rule fails — the sidebar
              passes today only because all of its content is inside a button
              or a link. */}
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Switch tenant. Current: ${label}`} />}
          >
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="ml-auto size-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-56">
            {tenants.data && tenants.data.length > 0 ? (
              tenants.data.map((entry) => (
                <DropdownMenuItem
                  key={entry.tenant.id}
                  // `render` is Base UI's `asChild`: the menu item IS the
                  // anchor, so it opens in a new tab like any other link.
                  render={<Link to="/tenants/$slug" params={{ slug: entry.tenant.slug }} />}
                >
                  <span className="truncate">{entry.tenant.name}</span>
                </DropdownMenuItem>
              ))
            ) : tenants.isError ? (
              // A FAILED load is not an empty account, and this menu used to
              // say it was: `tenants.data` is undefined in both cases, so a
              // 500 rendered "No tenants yet" as a statement of fact about
              // something the app did not know. The same defect the three
              // list surfaces carried (see LoadError's doc comment); a closed
              // dropdown changes its blast radius, not its correctness.
              //
              // Not `LoadError` — a menu is no place for an alert region and
              // a nested retry button. Stating the failure is the whole
              // requirement, and "All tenants" below already leads to the
              // page that DOES offer a retry.
              <DropdownMenuItem disabled>Tenants could not be loaded</DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>No tenants yet</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to={ROUTES.tenants} />}>All tenants</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
