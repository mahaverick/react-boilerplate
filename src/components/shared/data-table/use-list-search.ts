import { useNavigate, useSearch } from '@tanstack/react-router'
import type { z } from 'zod'
import { track, type AnalyticsKey } from '@/observability/telemetry'
import {
  cleanSearch,
  filterUrlValue,
  listRequest,
  listValues,
  sortFilterValues,
  type ListDefinition,
  type ListUrlSearch,
  type ListValues,
} from '@/schemas/list.schemas'
import {
  DEFAULT_PAGE_SIZE,
  type ListDirection,
  type ListPageInfo,
  type ListRequest,
  type PageSize,
} from '@/types/list.types'

/**
 * Which page a cursor opened, 0 for the first, recorded as this tab pages so
 * "Showing 21–40" can count. A cursor is unique to the view it was cut from,
 * so the map needs no other key. A URL opened with a cursor this tab never
 * handed out has no entry, and the count is not shown.
 */
const pageIndexes = new Map<string, number>()

/** How many views' page positions a tab keeps; the oldest are forgotten, which only hides "Showing". */
const MAX_PAGE_INDEXES = 50

/**
 * Records which page a cursor opened, keeping only the most recent entries.
 * @param key - From `pageKey`.
 * @param index - The page's position, from 0.
 */
function recordPageIndex(key: string, index: number): void {
  pageIndexes.delete(key)
  pageIndexes.set(key, index)
  for (const oldest of pageIndexes.keys()) {
    if (pageIndexes.size <= MAX_PAGE_INDEXES) break
    pageIndexes.delete(oldest)
  }
}

/**
 * Forgets every recorded page position. For tests only: the map is module
 * state, so a position one test recorded would otherwise reach the next.
 */
export function resetListPositions(): void {
  pageIndexes.clear()
}

/** `pageIndexes`' key for a cursor and its direction. */
function pageKey(cursor: string, direction: ListDirection): string {
  return `${direction}:${cursor}`
}

/** A URL patch: a value per URL key, `undefined` to drop the key. */
type UrlPatch = Record<string, string | number | boolean | undefined>

/** What `useListSearch` returns: one list's URL state and the writes that change it. */
export interface ListSearchState {
  definition: ListDefinition<z.ZodRawShape>
  values: ListValues
  /** The API request for `values`, without `total`. */
  request: ListRequest
  /** A search term or any filter is set, so an empty page means "nothing matches". */
  isFiltered: boolean
  /** Which page this is, from 0, or `undefined` when this tab did not page here. */
  pageIndex: number | undefined
  setSearch: (term: string) => void
  setFilter: (name: string, values: readonly string[]) => void
  /** Sets several filters in one navigation, such as a date range's two bounds. */
  setFilters: (picks: Readonly<Record<string, readonly string[]>>) => void
  /** Clears the search and every filter. */
  reset: () => void
  /**
   * Sorts by `key`, or by the default when `key` is the default. `column`
   * names the clicked column in `table_sorted`.
   */
  setSort: (key: string, column: AnalyticsKey) => void
  setLimit: (limit: PageSize) => void
  setHidden: (columnIds: readonly string[]) => void
  next: (page: ListPageInfo) => void
  prev: (page: ListPageInfo) => void
  /** Back to the first page of the same view. `replace` swaps the current entry. */
  firstPage: (options?: { replace?: boolean }) => void
}

/**
 * Drops the keys a patch cleared, so a default never lingers in the URL as
 * an empty value.
 * @param search - The merged search.
 * @returns The search without `undefined` or empty-string values.
 */
function tidy(search: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(search).filter(([, value]) => value !== undefined && value !== '')
  )
}

/**
 * One list's URL state: search, filters, sort, cursor, direction, page size
 * and hidden columns, read from the route's validated search and written
 * back with defaults left out; a search is written cleaned (`cleanSearch`),
 * and a blank one is no search. Any write but paging and column choice drops
 * the cursor, since a cursor belongs to the view it was cut from; hiding a
 * column changes no row, so the page stays. Typing and paging fire
 * `table_filtered`, `table_sorted` and `table_paged` with fixed values only.
 *
 * The search is read with `strict: false`, so a route module need not import
 * its own `Route` back (react's settings pages avoid that for the bundle).
 * @param definition - The list, from `defineList`.
 * @returns The state and its writes.
 */
export function useListSearch<E extends z.ZodRawShape>(
  definition: ListDefinition<E>
): ListSearchState {
  const list = definition as unknown as ListDefinition<z.ZodRawShape>
  const raw: ListUrlSearch = useSearch({ strict: false })
  const navigate = useNavigate()
  const values = listValues(list, raw)
  const { urlKey, table } = list
  const pageIndex =
    values.cursor === undefined ? 0 : pageIndexes.get(pageKey(values.cursor, values.direction))

  /** Merges `patch` into the current search and navigates; a push unless `replace`. */
  const write = (patch: UrlPatch, replace = false) =>
    void navigate({
      to: '.',
      // The keys are chosen at run time, which the router's types cannot follow; the route's schema validates them on arrival.
      search: ((prev: Record<string, unknown>) => tidy({ ...prev, ...patch })) as never,
      replace,
    })

  /** The patch that drops the cursor and its direction. */
  const firstPagePatch: UrlPatch = {
    [urlKey('cursor')]: undefined,
    [urlKey('direction')]: undefined,
  }

  const isFiltered = cleanSearch(values.search) !== '' || Object.keys(values.filters).length > 0

  /** Writes each named filter's picks, from the first page; an unknown name is ignored. */
  const setFilters = (picks: Readonly<Record<string, readonly string[]>>) => {
    const patch: UrlPatch = { ...firstPagePatch }
    let changed = false
    for (const [name, picked] of Object.entries(picks)) {
      const filter = list.filters[name]
      if (filter === undefined) continue
      // The URL holds a comma list in the API's order, so compare in that order.
      const ordered = filter.kind === 'list' ? sortFilterValues(picked) : picked
      const value = filterUrlValue(filter, ordered)
      if (value !== filterUrlValue(filter, values.filters[name] ?? [])) changed = true
      patch[urlKey(name)] = value
    }
    if (!changed) return
    track('table_filtered', { table })
    write(patch)
  }

  return {
    definition: list,
    values,
    request: listRequest(list, values),
    isFiltered,
    pageIndex,
    setSearch: (term) => {
      const next = cleanSearch(term)
      if (next === cleanSearch(values.search)) return
      track('table_filtered', { table })
      write({ ...firstPagePatch, [urlKey('search')]: next === '' ? undefined : next }, true)
    },
    setFilter: (name, picked) => setFilters({ [name]: picked }),
    setFilters,
    reset: () => {
      if (!isFiltered) return
      track('table_filtered', { table })
      const cleared: UrlPatch = { ...firstPagePatch, [urlKey('search')]: undefined }
      for (const name of Object.keys(list.filters)) cleared[urlKey(name)] = undefined
      write(cleared)
    },
    setSort: (key, column) => {
      if (key === values.sort) return
      const isDefault = key === list.sorts[0]
      track('table_sorted', {
        table,
        sort: column,
        direction: isDefault ? 'default' : key.startsWith('-') ? 'desc' : 'asc',
      })
      write({ ...firstPagePatch, [urlKey('sort')]: isDefault ? undefined : key })
    },
    setLimit: (limit) => {
      if (limit === values.limit) return
      write({
        ...firstPagePatch,
        [urlKey('limit')]: limit === DEFAULT_PAGE_SIZE ? undefined : limit,
      })
    },
    setHidden: (columnIds) =>
      write({ [urlKey('hidden')]: columnIds.length === 0 ? undefined : columnIds.join(',') }),
    next: (page) => {
      if (!page.hasNext || page.nextCursor === null) return
      // A page with nothing before it is the first, whatever the tab recorded: the API answers a cursor whose page came back empty with its first page.
      const from = page.hasPrev ? pageIndex : 0
      if (from !== undefined) recordPageIndex(pageKey(page.nextCursor, 'next'), from + 1)
      track('table_paged', { table, direction: 'next' })
      write({ [urlKey('cursor')]: page.nextCursor, [urlKey('direction')]: undefined })
    },
    prev: (page) => {
      if (!page.hasPrev || page.prevCursor === null) return
      // A `prev` page with nothing after it is the API's last-page answer to a cursor whose page came back empty: its position is unknown.
      const from = values.direction === 'prev' && !page.hasNext ? undefined : pageIndex
      if (from !== undefined && from > 0) {
        recordPageIndex(pageKey(page.prevCursor, 'prev'), from - 1)
      }
      track('table_paged', { table, direction: 'prev' })
      write({ [urlKey('cursor')]: page.prevCursor, [urlKey('direction')]: 'prev' })
    },
    firstPage: (options) => write(firstPagePatch, options?.replace ?? false),
  }
}
