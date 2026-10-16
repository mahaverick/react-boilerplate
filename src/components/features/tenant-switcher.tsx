import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { IconBuilding, IconPlus, IconSelector } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { settingsActiveSection } from '@/constants/settings'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { cn } from '@/lib/utils'
import { tenantQueryOptions, useTenants } from '@/queries/tenant.queries'

/** One row of the switcher: a tenant the caller belongs to. */
interface TenantOption {
  id: string
  name: string
  slug: string
  suspended: boolean
}

/** A labelled run of options, the shape the combobox's grouped `items` take. */
interface OptionGroup {
  label: string
  items: TenantOption[]
}

/** Whether the tenant's name or slug contains the search text; an empty search matches all. */
function matches(option: TenantOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || option.name.toLowerCase().includes(needle) || option.slug.includes(needle)
}

/**
 * What the popup says when it has no rows to show. The list's three states
 * stay apart: in flight, failed, and empty. A cached list keeps rendering
 * through a background refetch.
 */
function ownTenantsMessage({
  hasData,
  isPending,
  isEmpty,
}: {
  hasData: boolean
  isPending: boolean
  isEmpty: boolean
}): string | null {
  if (!hasData) return isPending ? 'Loading tenants…' : 'Tenants could not be loaded'
  return isEmpty ? 'No tenants yet' : null
}

/**
 * A navigation combobox, and nothing else. Tenant scope is the URL
 * (`useCurrentTenantSlug`): a tenant page's `$slug`, else the shell's
 * `?tenant`. Choosing an option on a workspace settings page opens the same
 * section for the chosen tenant; on another `$slug` page it opens
 * `/tenants/$slug`; on any other page it stays and changes only `?tenant`.
 *
 * It lists the caller's memberships, minus the platform tenant (the user menu
 * links that). Staff search every tenant in Apex, not here. A suspended tenant
 * is listed but disabled: its routes answer 404 until staff reactivate it.
 *
 * Styled after shadcn's sidebar-07 `TeamSwitcher`. The popup ends with a link
 * to the tenants page, where the create-tenant form lives.
 *
 * It sits in its own `nav` landmark: axe's `region` rule exempts a bare
 * button but not one whose role is `combobox`, so the trigger's text would
 * otherwise sit in no landmark. It reads `$slug` with `strict: false`, since
 * the app shell renders it on routes without one, and filters before
 * rendering (`filter={null}`).
 *
 * The trigger says whether the list is loading or failed, rather than "Choose
 * a tenant", until the list is in; a failed list offers Try again in the popup.
 */
export function TenantSwitcher() {
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const tenants = useTenants()
  const { slug } = useParams({ strict: false })
  const currentSlug = useCurrentTenantSlug()
  const pathname = useLocation({ select: (location) => location.pathname })
  const section = settingsActiveSection(pathname)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = useQuery({ ...tenantQueryOptions(slug ?? ''), enabled: slug !== undefined })

  const own = (tenants.data ?? [])
    .filter((entry) => !entry.isPlatform)
    .map((entry): TenantOption => ({
      id: entry.tenant.id,
      name: entry.tenant.name,
      slug: entry.tenant.slug,
      suspended: entry.tenant.lifecycleState === 'suspended',
    }))
  const ownMatches = own.filter((option) => matches(option, query))
  const groups: OptionGroup[] =
    ownMatches.length > 0 ? [{ label: 'Your tenants', items: ownMatches }] : []

  const openName = own.find((option) => option.slug === currentSlug)?.name ?? current.data?.name
  const label =
    openName ??
    (tenants.data !== undefined
      ? 'Choose a tenant'
      : tenants.isError
        ? 'Tenants could not be loaded'
        : 'Loading tenants…')
  const ownMessage = ownTenantsMessage({
    hasData: tenants.data !== undefined,
    isPending: tenants.isPending,
    isEmpty: own.length === 0,
  })
  const noMatches = query.trim() !== '' && !tenants.isPending && ownMessage === null

  return (
    <nav aria-label="Tenant">
      <SidebarMenu>
        <SidebarMenuItem>
          <Combobox<TenantOption>
            items={groups}
            filter={null}
            value={null}
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (!next) setQuery('')
            }}
            inputValue={query}
            onInputValueChange={(next) => setQuery(next)}
            itemToStringLabel={(option) => option.name}
            isItemEqualToValue={(a, b) => a.id === b.id}
            onValueChange={(option) => {
              if (!option || option.suspended) return
              setOpen(false)
              setQuery('')
              if (section?.group === 'workspace') {
                void navigate({ to: section.to, params: { slug: option.slug } })
              } else if (slug !== undefined) {
                void navigate({ to: '/tenants/$slug', params: { slug: option.slug } })
              } else {
                // A push, not a replace, so Back returns to the previous tenant on this page.
                void navigate({ to: '.', search: (prev) => ({ ...prev, tenant: option.slug }) })
              }
            }}
          >
            {/* The primitive, not ui/combobox's trigger, which appends a chevron beside our selector icon. */}
            <ComboboxPrimitive.Trigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                  aria-label={`Switch tenant. Current: ${label}`}
                />
              }
            >
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <IconBuilding aria-hidden="true" className="size-4" />
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{label}</span>
                {openName !== undefined && (
                  <span className="truncate text-xs text-muted-foreground">Tenant</span>
                )}
              </span>
              <IconSelector aria-hidden="true" className="ml-auto size-4" />
            </ComboboxPrimitive.Trigger>
            <ComboboxContent
              aria-label="Switch tenant"
              side={isMobile ? 'bottom' : 'right'}
              align="start"
              sideOffset={4}
              className="w-72"
            >
              <ComboboxInput
                showTrigger={false}
                aria-label="Search tenants"
                placeholder="Search your tenants…"
              />
              {ownMessage && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{ownMessage}</p>
              )}
              {tenants.data === undefined && tenants.isError && (
                <div className="px-2 pb-1.5">
                  <Button variant="outline" size="sm" onClick={() => void tenants.refetch()}>
                    Try again
                  </Button>
                </div>
              )}
              <ComboboxEmpty>{noMatches ? 'No tenants match your search' : null}</ComboboxEmpty>
              <ComboboxList>
                {(group: OptionGroup) => (
                  <ComboboxGroup key={group.label} items={group.items}>
                    <ComboboxLabel>{group.label}</ComboboxLabel>
                    <ComboboxCollection>
                      {(option: TenantOption) => (
                        <ComboboxItem
                          key={option.id}
                          value={option}
                          disabled={option.suspended}
                          className="data-disabled:opacity-100"
                        >
                          <span className={cn('truncate', option.suspended && 'opacity-50')}>
                            {option.name}
                          </span>
                          {option.suspended && (
                            <span className="ml-auto text-xs font-medium">Suspended</span>
                          )}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
              <div className="border-t p-1">
                <Link
                  to={ROUTES.tenants}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-6 items-center justify-center rounded-md border">
                    <IconPlus aria-hidden="true" className="size-4" />
                  </span>
                  Create a tenant
                </Link>
              </div>
            </ComboboxContent>
          </Combobox>
        </SidebarMenuItem>
      </SidebarMenu>
    </nav>
  )
}
