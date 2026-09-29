import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { useState } from 'react'
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
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { tenantQueryOptions, useTenants } from '@/queries/tenant.queries'

interface TenantOption {
  id: string
  name: string
  slug: string
}

interface OptionGroup {
  label: string
  items: TenantOption[]
}

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
 * A navigation combobox, and nothing else. Tenant scope is the URL: the API
 * resolves the tenant from the `:slug` path param alone, so choosing an option
 * navigates to `/tenants/$slug`.
 *
 * It lists the caller's memberships, minus the platform tenant (the user menu
 * links that). Staff search every tenant in Apex, not here.
 *
 * It sits in its own `nav` landmark: axe's `region` rule exempts a bare
 * button but not one whose role is `combobox`, so the trigger's text would
 * otherwise sit in no landmark. It reads `$slug` with `strict: false`, since
 * the app shell renders it on routes without one, and filters before
 * rendering (`filter={null}`).
 */
export function TenantSwitcher() {
  const navigate = useNavigate()
  const tenants = useTenants()
  const { slug } = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = useQuery({ ...tenantQueryOptions(slug ?? ''), enabled: slug !== undefined })

  const own = (tenants.data ?? [])
    .filter((entry) => !entry.isPlatform)
    .map((entry): TenantOption => ({
      id: entry.tenant.id,
      name: entry.tenant.name,
      slug: entry.tenant.slug,
    }))
  const ownMatches = own.filter((option) => matches(option, query))
  const groups: OptionGroup[] =
    ownMatches.length > 0 ? [{ label: 'Your tenants', items: ownMatches }] : []

  const label = own.find((option) => option.slug === slug)?.name ?? current.data?.name ?? 'Tenants'
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
              if (!option) return
              setOpen(false)
              setQuery('')
              void navigate({ to: '/tenants/$slug', params: { slug: option.slug } })
            }}
          >
            <ComboboxTrigger
              render={
                <SidebarMenuButton size="lg" aria-label={`Switch tenant. Current: ${label}`} />
              }
            >
              <Building2 className="size-4 shrink-0" />
              <span className="flex-1 truncate text-left">{label}</span>
            </ComboboxTrigger>
            <ComboboxContent aria-label="Switch tenant" className="w-72">
              <ComboboxInput
                showTrigger={false}
                aria-label="Search tenants"
                placeholder="Search your tenants…"
              />
              {ownMessage && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{ownMessage}</p>
              )}
              <ComboboxEmpty>{noMatches ? 'No tenants match your search' : null}</ComboboxEmpty>
              <ComboboxList>
                {(group: OptionGroup) => (
                  <ComboboxGroup key={group.label} items={group.items}>
                    <ComboboxLabel>{group.label}</ComboboxLabel>
                    <ComboboxCollection>
                      {(option: TenantOption) => (
                        <ComboboxItem key={option.id} value={option}>
                          <span className="truncate">{option.name}</span>
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </SidebarMenuItem>
      </SidebarMenu>
    </nav>
  )
}
