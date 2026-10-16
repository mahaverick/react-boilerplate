/**
 * @file The URL contract every list page shares. `defineList` builds a
 * route's `validateSearch` from the list's sort whitelist and filters, and
 * `listRequest` turns the validated search into the API request. Params use
 * the API's names (camelCase, one word each), so a list's URL reads like its
 * request. Defaults are omitted from both, so a default view's URL is clean.
 */
import { z } from 'zod'
import type { AnalyticsKey } from '@/observability/telemetry'
import { searchText } from '@/schemas/search.schemas'
import {
  DEFAULT_PAGE_SIZE,
  LIST_DIRECTIONS,
  MAX_SEARCH_LENGTH,
  PAGE_SIZES,
  type ListDirection,
  type ListRequest,
  type PageSize,
} from '@/types/list.types'

/** How one filter travels: a comma list of known values, a yes/no, a record id, or a calendar day. */
export type ListFilter =
  | { kind: 'list'; values: readonly string[] }
  | { kind: 'boolean' }
  | { kind: 'id' }
  | { kind: 'day' }

/**
 * A filter that takes any number of `values`, written as a comma list
 * (`status=active,inactive`). Unknown and repeated values are dropped, and the rest are sorted as the API sorts them.
 * @param values - Every value the API accepts.
 */
export function listFilter(values: readonly string[]): ListFilter {
  return { kind: 'list', values }
}

/** A yes/no filter (`verified=true`). The router parses `true` and `false` as booleans. */
export function booleanFilter(): ListFilter {
  return { kind: 'boolean' }
}

/** A filter on one record id (`tenant=<uuid>`); anything that is not a UUID is no filter. */
export function idFilter(): ListFilter {
  return { kind: 'id' }
}

/** A calendar-day bound (`from=2026-10-01`); anything else is no bound. */
export function dayFilter(): ListFilter {
  return { kind: 'day' }
}

/** The longest cursor the API accepts (4096 characters); it refuses a longer one. Every cursor it issues fits. */
const MAX_CURSOR_LENGTH = 4096

/**
 * A search term made safe to send: NUL stripped, trimmed, and cut to what the
 * API accepts. An empty result means no search, and callers then leave
 * `search` out of the URL and the request (the API refuses an empty one).
 * @param text - What the reader typed or the URL held.
 * @returns The term, possibly empty.
 */
export function cleanSearch(text: string): string {
  return (
    text
      .replaceAll('\0', '')
      .trim()
      .slice(0, MAX_SEARCH_LENGTH)
      // A cut can leave half of a surrogate pair, which encodeURIComponent refuses.
      .replace(/[\uD800-\uDBFF]$/, '')
      .trimEnd()
  )
}

/** The shared fields every list's URL may carry, before any prefix. */
export const LIST_FIELDS = ['search', 'sort', 'cursor', 'direction', 'limit', 'hidden'] as const

/** One of `LIST_FIELDS`, or a filter's name. */
type ListKey = (typeof LIST_FIELDS)[number] | (string & {})

/** A validated search as the router holds it: every value optional, keyed by URL name. */
export type ListUrlSearch = Record<string, string | number | boolean | undefined>

/** What `defineList` takes. */
export interface ListDefinitionInput<E extends z.ZodRawShape> {
  /** The API's sort whitelist, its default first. The default is never written or sent. */
  sorts: readonly [string, ...string[]]
  /** The list's filters, by their API name. */
  filters: Readonly<Record<string, ListFilter>>
  /** The list's name in `table_filtered`, `table_sorted` and `table_paged`. */
  table: AnalyticsKey
  /**
   * For a second list on one route: its URL keys become `<prefix>Search`,
   * `<prefix>Sort`, `<prefix>Status` and so on, so the two lists never share
   * a param. The request keeps the API's names.
   */
  prefix?: string
  /** The route's own params beside the list's, such as a tab or a range. */
  extra?: E
  /**
   * The other lists on the same route, each with its own `prefix`: their
   * fields join this list's schema, so the route's one `validateSearch` keeps
   * them all.
   */
  also?: readonly ListDefinition<z.ZodRawShape>[]
}

/** The route's own params' type, input or output side; nothing when there are none. */
type ExtraSearch<E extends z.ZodRawShape, Side extends 'input' | 'output'> = keyof E extends never
  ? unknown
  : Side extends 'input'
    ? z.input<z.ZodObject<E>>
    : z.output<z.ZodObject<E>>

/** A list's URL contract, built once per list at module scope. */
export interface ListDefinition<
  E extends z.ZodRawShape = Record<never, never>,
> extends ListDefinitionInput<E> {
  /** This list's own fields' schemas, by URL name, for a list that shares its route. */
  shape: z.ZodRawShape
  /** The route's `validateSearch`. */
  schema: z.ZodType<
    ListUrlSearch & ExtraSearch<E, 'output'>,
    ListUrlSearch & ExtraSearch<E, 'input'>
  >
  /** A field's or filter's URL name: itself, or prefixed. */
  urlKey: (key: ListKey) => string
}

/**
 * Sorts filter values the way the API does, so one selection has one URL and one cache key.
 * @param values - The picked values.
 * @returns A sorted copy.
 */
export function sortFilterValues(values: readonly string[]): string[] {
  return values.toSorted((a, b) => a.localeCompare(b, 'en'))
}

/**
 * A comma list of `values`: unknown and repeated entries are dropped, and a
 * list left empty is no filter.
 * @param values - Every value the API accepts.
 */
function commaList(values: readonly string[]) {
  return z
    .string()
    .transform((raw) =>
      sortFilterValues(
        [...new Set(raw.split(',').map((part) => part.trim()))].filter((part) =>
          values.includes(part)
        )
      ).join(',')
    )
    .pipe(z.string().min(1))
    .optional()
    .catch(undefined)
}

/**
 * The schema for one filter's URL value. Each one drops a malformed value
 * rather than failing the page.
 * @param filter - The filter.
 */
function filterSchema(filter: ListFilter): z.ZodType {
  switch (filter.kind) {
    case 'list':
      return commaList(filter.values)
    case 'boolean':
      return z.boolean().optional().catch(undefined)
    case 'id':
      return z.uuid().optional().catch(undefined)
    case 'day':
      // Years 0001-9998, as the API takes them.
      return z.iso
        .date()
        .refine((day) => day >= '0001-01-01' && day <= '9998-12-31')
        .optional()
        .catch(undefined)
  }
}

/**
 * A route's `validateSearch` for one list: `search`, `sort` (whitelisted),
 * `cursor`, `direction`, `limit` (20, 50 or 100), `hidden` and each filter,
 * every field `.optional().catch(undefined)`.
 * @param sorts - The sort whitelist, its default first.
 * @param filters - The list's filters.
 * @param urlKey - Maps a field's name to its URL name.
 * @returns The fields' schemas, keyed by URL name.
 */
export function listSearchSchema(
  sorts: readonly [string, ...string[]],
  filters: Readonly<Record<string, ListFilter>>,
  urlKey: (key: ListKey) => string = (key) => key
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {
    // A numeric-looking term (`?search=2026`) arrives as a number; searchText takes it back as text.
    [urlKey('search')]: searchText,
    [urlKey('sort')]: z.enum(sorts).optional().catch(undefined),
    [urlKey('cursor')]: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
    [urlKey('direction')]: z.enum(LIST_DIRECTIONS).optional().catch(undefined),
    // The router parses `?limit=50` as the number 50.
    [urlKey('limit')]: z.literal(PAGE_SIZES).optional().catch(undefined),
    [urlKey('hidden')]: z.string().min(1).optional().catch(undefined),
  }
  for (const [name, filter] of Object.entries(filters)) shape[urlKey(name)] = filterSchema(filter)
  return shape
}

/**
 * One list's URL contract: its route schema and its key mapping, beside the
 * sorts, filters and analytics name it was built from.
 * @param input - The list's sorts, filters, analytics name, optional prefix and the route's own params.
 * @returns The definition `useListSearch` and `listRequest` read.
 */
export function defineList<E extends z.ZodRawShape = Record<never, never>>(
  input: ListDefinitionInput<E>
): ListDefinition<E> {
  const { prefix } = input
  /** A field's URL name: as is, or after the prefix with its first letter raised. */
  const urlKey = (key: ListKey): string =>
    prefix === undefined ? key : `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`
  const shape = listSearchSchema(input.sorts, input.filters, urlKey)
  const routeShape: z.ZodRawShape = { ...input.extra, ...shape }
  for (const other of input.also ?? []) Object.assign(routeShape, other.shape)
  return {
    ...input,
    urlKey,
    shape,
    // The shape's keys are chosen at run time, so its type is stated rather than inferred.
    schema: z.object(routeShape) as unknown as ListDefinition<E>['schema'],
  }
}

/** A list's search by field name, after validation, with defaults filled in. */
export interface ListValues {
  search: string
  /** The effective sort: the URL's, or the default. */
  sort: string
  cursor: string | undefined
  direction: ListDirection
  limit: PageSize
  hidden: readonly string[]
  /** Every filter as a list of string values; a yes/no filter is `['true']` or `['false']`. */
  filters: Readonly<Record<string, readonly string[]>>
}

/**
 * Reads one list's fields out of the route's validated search.
 * @param definition - The list.
 * @param search - The route's validated search.
 * @returns The values, defaults filled in.
 */
export function listValues(
  definition: ListDefinition<z.ZodRawShape>,
  search: ListUrlSearch
): ListValues {
  /** One field's validated URL value. */
  const read = (key: ListKey) => search[definition.urlKey(key)]
  const filters: Record<string, readonly string[]> = {}
  for (const [name, filter] of Object.entries(definition.filters)) {
    const value = read(name)
    if (value === undefined) continue
    filters[name] = filter.kind === 'list' ? String(value).split(',') : [String(value)]
  }
  const sort = read('sort')
  const limit = read('limit')
  const cursor = read('cursor')
  const hidden = read('hidden')
  return {
    search: String(read('search') ?? ''),
    sort: typeof sort === 'string' ? sort : definition.sorts[0],
    cursor: typeof cursor === 'string' && cursor !== '' ? cursor : undefined,
    direction: read('direction') === 'prev' ? 'prev' : 'next',
    limit: PAGE_SIZES.find((size) => size === limit) ?? DEFAULT_PAGE_SIZE,
    hidden: typeof hidden === 'string' ? hidden.split(',') : [],
    filters,
  }
}

/**
 * The URL value that writes `values` for one filter: a comma list, the first
 * value for an id or a day, a boolean for a yes/no filter (only when exactly
 * one of yes and no is picked), and `undefined` (no filter) for no values.
 * @param filter - The filter.
 * @param values - The picked values.
 * @returns The value to write.
 */
export function filterUrlValue(
  filter: ListFilter,
  values: readonly string[]
): string | boolean | undefined {
  if (values.length === 0) return undefined
  if (filter.kind === 'list') return values.join(',')
  if (filter.kind === 'boolean') return values.length === 1 ? values[0] === 'true' : undefined
  return values[0]
}

/**
 * The API request for a list's values: the default sort, the default page
 * size and `direction=next` are left out, `direction` is sent only with a
 * cursor, and `search` and `cursor` are left out when empty (the API refuses
 * `search=` and `cursor=`). Pure, so a route loader prefetches exactly what the page reads.
 * @param definition - The list.
 * @param values - From `listValues`.
 * @returns The request params.
 */
export function listRequest(
  definition: ListDefinition<z.ZodRawShape>,
  values: ListValues
): ListRequest {
  const request: ListRequest = {}
  const term = cleanSearch(values.search)
  if (term !== '') request.search = term
  if (values.sort !== definition.sorts[0]) request.sort = values.sort
  if (values.cursor !== undefined && values.cursor !== '') {
    request.cursor = values.cursor
    if (values.direction === 'prev') request.direction = 'prev'
  }
  if (values.limit !== DEFAULT_PAGE_SIZE) request.limit = values.limit
  for (const [name, filter] of Object.entries(definition.filters)) {
    const value = filterUrlValue(filter, values.filters[name] ?? [])
    if (value !== undefined) request[name] = value
  }
  return request
}
