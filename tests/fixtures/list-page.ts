import type { ListPage, ListPageInfo, ListTotal } from '@/types/list.types'

/**
 * A list endpoint's `data`, for MSW handlers: `items`, with no page either
 * side unless `page` says so, and a total only when given.
 * @param items - The page's rows.
 * @param page - Cursors and flags to set; the rest are null, false and 20.
 * @param total - The capped total, for a first page asked with `total=1`.
 * @returns The page.
 */
export function listPage<T>(
  items: T[],
  page: Partial<ListPageInfo> = {},
  total?: ListTotal
): ListPage<T> {
  return {
    items,
    page: {
      nextCursor: null,
      prevCursor: null,
      hasNext: false,
      hasPrev: false,
      limit: 20,
      ...page,
    },
    ...(total === undefined ? {} : { total }),
  }
}
