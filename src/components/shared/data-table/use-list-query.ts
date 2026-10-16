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
  /** The API refused the cursor and the list is going back to its first page; `query` reads as pending until it has. */
  isRestarting: boolean
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
 * error the table shows. While the restart is pending the query reads as
 * pending, never as an error. The kept total is held by an observer on the
 * first page's entry, so it survives collection and refreshes after an
 * invalidation; it is the new view's, never the view being left.
 * @param list - From `useListSearch`.
 * @param options - The list's `…ListOptions`, called with the request.
 * @param options.enabled - False holds the request, for a role gate.
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

  // A disabled observer on the first page's entry keeps it alive while a later page is open (see the JSDoc).
  const firstRequest: ListRequest = { ...list.request }
  delete firstRequest.cursor
  delete firstRequest.direction
  const firstOptions = options(firstRequest)
  const firstCached = queryClient.getQueryData(firstOptions.queryKey) !== undefined
  const first = useQuery({
    ...firstOptions,
    // No placeholder: the total of the view being left must not stand in for the new view's.
    placeholderData: undefined,
    enabled: enabled && cursor !== undefined && firstCached,
    // Fresh for good, so enabling it never fetches; an invalidation still refetches it.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const total = first.data?.total

  if (refused) {
    return {
      list,
      // One cast: a pending-shaped view of the failed query, so no consumer renders the refused cursor as a load error.
      query: {
        ...query,
        status: 'pending',
        isPending: true,
        isLoading: query.isFetching,
        isRefetchError: false,
        failureReason: null,
        failureCount: 0,
        isError: false,
        isLoadingError: false,
        isSuccess: false,
        error: null,
        data: undefined,
        isPlaceholderData: false,
      } as unknown as UseQueryResult<ListPage<T>>,
      items: [],
      page: undefined,
      isRestarting: true,
      total,
    }
  }

  return {
    list,
    query,
    items: query.data?.items ?? [],
    page: query.data?.page,
    isRestarting: false,
    total,
  }
}
