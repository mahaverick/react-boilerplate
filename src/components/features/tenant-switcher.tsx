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
 * What the popup says about the caller's own tenants when it has no rows to
 * show for them. The list's three states stay apart: in flight, failed, and
 * empty. A cached list keeps rendering through a background refetch, and staff
 * with no memberships get no empty message, since the platform list follows.
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
  return isEmpty && !staff ? 'No tenants yet' : null
}

/**
 * A navigation combobox, and nothing else. Tenant scope is the URL: the API
 * resolves the tenant from the `:slug` path param alone, so choosing an option
 * navigates to `/tenants/$slug`.
 *
 * "Your tenants" is the caller's memberships, minus the platform tenant (the
 * user menu links that). Staff also get "All tenants": a server-side search,
 * run only while the popup is open, de-duplicated against "Your tenants",
 * paged by a Load more option, and leaving out any tenant that is not active,
 * which `resolveTenant` would answer with a 404.
 *
 * The Load more option stays selectable after a failed page, since clicking
 * it again is the retry, and its click handler replaces Base UI's (which
 * would select and close); Enter on a highlighted option clicks it too.
 *
 * It sits in its own `nav` landmark: axe's `region` rule exempts a bare
 * button but not one whose role is `combobox`, so the trigger's text would
 * otherwise sit in no landmark. It reads `$slug` with `strict: false`, since
 * the app shell renders it on routes without one, and filters nothing itself
 * (`filter={null}`): the API filters "All tenants", and "Your tenants" is
 * filtered before rendering.
 */
export function TenantSwitcher() {
  const navigate = useNavigate()
  const tenants = useTenants()
  const staff = useAuthStore((state) => isStaff(state.user?.platformRole))
  const { slug } = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const term = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const all = usePlatformTenantSearch(term, { enabled: staff && open })
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
      .filter((row) => !ownIds.has(row.id) && row.lifecycleState === 'active')
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
      : all.data === undefined || all.isPlaceholderData
        ? 'Searching all tenants…'
        : null
  const searching = tenants.isPending || (staff && all.isFetching)
  const noMatches = query.trim() !== '' && !searching && ownMessage === null && allMessage === null

  return (
    <nav aria-label="Tenant">
      <SidebarMenu>
        <SidebarMenuItem>
          <Combobox<SwitcherOption>
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
                            disabled={all.isFetchingNextPage}
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
