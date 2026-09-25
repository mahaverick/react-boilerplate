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
import { isStaff } from '@/constants/roles'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  flattenTenantPages,
  SEARCH_DEBOUNCE_MS,
  usePlatformTenantSearch,
} from '@/queries/platform.queries'
import { tenantQueryOptions, useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

interface TenantOption {
  kind: 'tenant'
  id: string
  name: string
  slug: string
}

/** The "next page" row. An option, so it sits in the arrow-key order. */
interface LoadMoreOption {
  kind: 'more'
}

type SwitcherOption = TenantOption | LoadMoreOption

interface OptionGroup {
  label: string
  items: SwitcherOption[]
}

const LOAD_MORE: LoadMoreOption = { kind: 'more' }

function matches(option: TenantOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || option.name.toLowerCase().includes(needle) || option.slug.includes(needle)
}

/**
 * The Load more option's own label. A failed page stays retryable — the
 * option is never disabled for it — so the label is what tells the caller
 * the last attempt failed rather than that there is simply more to load.
 */
function loadMoreLabel({
  isFetchingNextPage,
  isFetchNextPageError,
}: {
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
}): string {
  if (isFetchingNextPage) return 'Loading more…'
  if (isFetchNextPageError) return 'Could not load more tenants'
  return 'Load more tenants'
}

/**
 * What the popup says about the caller's OWN tenants when it has no rows to
 * show for them. The list's three states stay apart: in flight, failed, and
 * genuinely empty. A cached list keeps rendering through a background refetch.
 */
function ownTenantsMessage({
  hasData,
  isPending,
  isEmpty,
  staff,
}: {
  hasData: boolean
  isPending: boolean
  isEmpty: boolean
  staff: boolean
}): string | null {
  if (!hasData) return isPending ? 'Loading tenants…' : 'Tenants could not be loaded'
  // Staff with no memberships still have the whole platform below.
  return isEmpty && !staff ? 'No tenants yet' : null
}

/**
 * A NAVIGATION combobox, and nothing else.
 *
 * Tenant scope is the URL: the API resolves the tenant from the `:slug` path
 * param alone, with no tenant header and no "current tenant" cookie, so there
 * is nothing to switch but the address. Choosing an option navigates to
 * `/tenants/$slug`; the current tenant is whatever the URL says.
 *
 * "Your tenants" is the caller's memberships, minus the platform tenant (the
 * user menu links that). Staff also get "All tenants": a server-side search,
 * de-duplicated against "Your tenants", paged by a Load more option.
 */
export function TenantSwitcher() {
  const navigate = useNavigate()
  const tenants = useTenants()
  const staff = useAuthStore((state) => isStaff(state.user?.platformRole))
  // `strict: false` because this renders in the app shell, on every
  // authenticated route, most of which have no `$slug` at all.
  const { slug } = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const term = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  // Only staff, and only while open: nobody else may call it, and a closed
  // popup has nothing to show.
  const all = usePlatformTenantSearch(term, { enabled: staff && open })
  // The `$slug` loader's own key, so on a tenant page this is a cache read.
  const current = useQuery({ ...tenantQueryOptions(slug ?? ''), enabled: slug !== undefined })

  const own = (tenants.data ?? [])
    .filter((entry) => !entry.isPlatform)
    .map((entry): TenantOption => ({
      kind: 'tenant',
      id: entry.tenant.id,
      name: entry.tenant.name,
      slug: entry.tenant.slug,
    }))
  const ownIds = new Set(own.map((option) => option.id))
  const ownMatches = own.filter((option) => matches(option, query))
  const others: SwitcherOption[] = [
    ...flattenTenantPages(all.data)
      .filter((row) => !ownIds.has(row.id))
      .map((row): TenantOption => ({ kind: 'tenant', id: row.id, name: row.name, slug: row.slug })),
    ...(all.hasNextPage ? [LOAD_MORE] : []),
  ]
  const groups: OptionGroup[] = [
    ...(ownMatches.length > 0 ? [{ label: 'Your tenants', items: ownMatches }] : []),
    ...(staff && others.length > 0 ? [{ label: 'All tenants', items: others }] : []),
  ]

  const label = own.find((option) => option.slug === slug)?.name ?? current.data?.name ?? 'Tenants'
  const ownMessage = ownTenantsMessage({
    hasData: tenants.data !== undefined,
    isPending: tenants.isPending,
    isEmpty: own.length === 0,
    staff,
  })
  const allMessage = !staff
    ? null
    : all.data === undefined && all.isError
      ? 'All tenants could not be loaded'
      : all.data === undefined
        ? 'Searching all tenants…'
        : null
  const searching = tenants.isPending || (staff && all.isFetching)
  const noMatches = query.trim() !== '' && !searching && ownMessage === null && allMessage === null

  return (
    // A real `nav` landmark, distinct from the sidebar's "Main" one: axe's
    // `region` rule exempts a bare `<button>` from needing one, but not a
    // trigger whose role is overridden to `combobox`, which this one's is.
    // Without this wrapper the trigger's own text — "Tenants" or the current
    // tenant's name — sits in no landmark at all on every authenticated page.
    <nav aria-label="Tenant">
      <SidebarMenu>
        <SidebarMenuItem>
          <Combobox<SwitcherOption>
            items={groups}
            // The API filters "All tenants"; "Your tenants" is filtered above.
            filter={null}
            value={null}
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (!next) setQuery('')
            }}
            inputValue={query}
            onInputValueChange={(next) => setQuery(next)}
            itemToStringLabel={(option) =>
              option.kind === 'tenant' ? option.name : loadMoreLabel(all)
            }
            isItemEqualToValue={(a, b) =>
              a.kind === 'tenant' && b.kind === 'tenant' ? a.id === b.id : a.kind === b.kind
            }
            onValueChange={(option) => {
              if (option?.kind !== 'tenant') return
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
                placeholder={staff ? 'Search all tenants…' : 'Search your tenants…'}
              />
              {ownMessage && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{ownMessage}</p>
              )}
              {allMessage && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{allMessage}</p>
              )}
              <ComboboxEmpty>{noMatches ? 'No tenants match your search' : null}</ComboboxEmpty>
              <ComboboxList>
                {(group: OptionGroup) => (
                  <ComboboxGroup key={group.label} items={group.items}>
                    <ComboboxLabel>{group.label}</ComboboxLabel>
                    <ComboboxCollection>
                      {(option: SwitcherOption) =>
                        option.kind === 'tenant' ? (
                          <ComboboxItem key={option.id} value={option}>
                            <span className="truncate">{option.name}</span>
                          </ComboboxItem>
                        ) : (
                          <ComboboxItem
                            key="load-more"
                            value={option}
                            // NOT disabled on `isFetchNextPageError`: clicking
                            // it again is the retry, so it must stay
                            // selectable rather than get stuck failed.
                            disabled={all.isFetchingNextPage}
                            // Enter on a highlighted option clicks it, so this
                            // one handler serves pointer and keyboard alike.
                            // Base UI's own handler would select and close.
                            onClick={(event) => {
                              event.preventBaseUIHandler()
                              void all.fetchNextPage()
                            }}
                          >
                            {loadMoreLabel(all)}
                          </ComboboxItem>
                        )
                      }
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
