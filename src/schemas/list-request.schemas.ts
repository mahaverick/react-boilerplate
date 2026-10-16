/**
 * @file The request side of the list contract: a route's validated search
 * read into a list's values, and those values turned into the API request.
 * Kept apart from `list.schemas` so the route `validateSearch` schemas, which
 * the entry bundle carries, do not carry the request builder with them.
 * Defaults are omitted from the request, so a default view sends no list params.
 */
import type { z } from 'zod'
import type { ListDefinition, ListFilter, ListKey, ListUrlSearch } from '@/schemas/list.schemas'
import {
  DEFAULT_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  PAGE_SIZES,
  type ListDirection,
  type ListRequest,
  type PageSize,
} from '@/types/list.types'

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
