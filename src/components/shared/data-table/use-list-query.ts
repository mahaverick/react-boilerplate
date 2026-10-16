import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'
import type { ListSearchState } from '@/components/shared/data-table/use-list-search'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { listQueryOptions } from '@/queries/list.queries'
import type { ListPage, ListPageInfo, ListRequest, ListTotal } from '@/types/list.types'

/** The `code` of the API's 400 for any refused cursor, the empty one included. */
const CURSOR_INVALID_CODE = 'CURSOR_INVALID'

/** Builds a list's query options for a request; a list's own `…ListOptions` function. */
export type ListOptionsFor<T> = (request: ListRequest) => ReturnType<typeof listQueryOptions<T>>

/** What `useListQuery` returns: the list's URL state, the query, and its page read out. */
export interface ListQueryState<T> {
  list: ListSearchState
  query: UseQueryResult<ListPage<T>>
  items: T[]
  page: ListPageInfo | undefined
  /** The view's capped total: this page's, or the first page's while paging the same view. */
  total: ListTotal | undefined
}

/**
 * One list's page, read for its URL state. The first page asks for the
 * capped total and later pages keep it from the first page's cache entry. A
 * 400 with `code: 'CURSOR_INVALID'` on a page with a cursor means the API
 * refused the cursor (tampered, rotated key, or cut from another view), so the
 * list drops `cursor` and `direction` and reloads its first page, replacing
 * the refused entry. The retry carries no cursor, so it cannot be refused for
 * one and the restart cannot loop. Any other 400 (a bad filter value) is an
 * error the table shows.
 * @param list - From `useListSearch`.
 * @param options - The list's `…ListOptions`, called with the request.
 * @param enabled - False holds the request, for a role gate.
 * @returns The state, query and page.
 */
export function useListQuery<T>(
  list: ListSearchState,
  options: ListOptionsFor<T>,
  { enabled = true }: { enabled?: boolean } = {}
): ListQueryState<T> {
  const queryClient = useQueryClient()
  const query = useQuery({ ...options(list.request), enabled })
  const { cursor } = list.values
  const refused =
    query.isError &&
    cursor !== undefined &&
    statusFrom(query.error) === 400 &&
    codeFrom(query.error) === CURSOR_INVALID_CODE
  const restart = useEffectEvent(() => list.firstPage({ replace: true }))

  useEffect(() => {
    if (refused) restart()
  }, [refused])

  const firstRequest: ListRequest = { ...list.request }
  delete firstRequest.cursor
  delete firstRequest.direction
  const total =
    query.data?.total ??
    queryClient.getQueryData<ListPage<T>>(options(firstRequest).queryKey)?.total

  return {
    list,
    query,
    items: query.data?.items ?? [],
    page: query.data?.page,
    total,
  }
}
