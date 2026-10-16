/**
 * @file The contract every list endpoint answers with: one page of items,
 * cursors both ways, and a capped total when the request asks for one.
 */

/** The page sizes a list offers. The first is the API's default. */
export const PAGE_SIZES = [20, 50, 100] as const

/** One of `PAGE_SIZES`. */
export type PageSize = (typeof PAGE_SIZES)[number]

/** The API's default page size, left out of the URL and the request. */
export const DEFAULT_PAGE_SIZE: PageSize = 20

/** How long a list's search box waits for typing to stop before it writes `?search=`. */
export const LIST_SEARCH_DEBOUNCE_MS = 250

/** The longest search term the API accepts; a longer one is refused with a 400. */
export const MAX_SEARCH_LENGTH = 100

/** Which way a cursor pages. `next` is the default and is never written. */
export const LIST_DIRECTIONS = ['next', 'prev'] as const

/** One of `LIST_DIRECTIONS`. */
export type ListDirection = (typeof LIST_DIRECTIONS)[number]

/** Where a page sits: a cursor each way, and whether there is more each way. */
export interface ListPageInfo {
  nextCursor: string | null
  prevCursor: string | null
  hasNext: boolean
  hasPrev: boolean
  limit: number
}

/** How many rows match, counted up to the API's cap. */
export interface ListTotal {
  count: number
  /** More rows match than `count`, which is then the cap. */
  capped: boolean
}

/** `data` of every list endpoint. */
export interface ListPage<T> {
  items: T[]
  page: ListPageInfo
  /** Present only when the request sent `total=1`. */
  total?: ListTotal
}

/**
 * The query a list request sends. A field left out is the API's default, so
 * the default sort, the default page size and `direction=next` are never sent.
 */
export interface ListRequest {
  search?: string
  sort?: string
  cursor?: string
  direction?: 'prev'
  limit?: number
  /** Each filter's value: a comma list, a record id, a day or a yes/no. */
  [filter: string]: string | number | boolean | undefined
}
