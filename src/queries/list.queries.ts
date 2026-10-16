/**
 * @file One query shape for every list endpoint: the request params from
 * `listRequest`, the `{ items, page, total }` page back, and the previous
 * page kept on screen while the next one loads.
 */
import { keepPreviousData, queryOptions, type QueryKey } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess } from '@/types/api.types'
import type { ListPage, ListRequest } from '@/types/list.types'

/** The 4xx statuses a retry can change: a request timeout and a rate limit. */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

/**
 * The default retry for a list read: once, unless the status says asking
 * again changes nothing. Every 4xx is final (a refused param or cursor, a
 * refused role, a missing route) except 408 and 429, which are tried once more.
 * @param failureCount - Failures so far.
 * @param error - The last failure.
 * @returns Whether to retry.
 */
export function retryList(failureCount: number, error: unknown): boolean {
  const status = statusFrom(error)
  const final =
    status !== undefined && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)
  return !final && failureCount < 1
}

/** What a list's query needs: where its key sits, its path, and its request. */
export interface ListQueryInput {
  /** The list's key prefix, under the resource's own keys, so a write's invalidation reaches every page. */
  key: QueryKey
  /** The endpoint, without the `/api/v1` prefix. */
  path: string
  request: ListRequest
  /** Overrides `retryList`. */
  retry?: (failureCount: number, error: Error) => boolean
  /** Overrides the client's default, for a list that must show what changed since it was last open. */
  staleTime?: number
}

/**
 * One page of a list. The first page (no cursor) asks for the capped total
 * too; later pages do not, and `useListQuery` keeps the first page's total.
 * The key holds the request without `total`, so the page a route loader
 * prefetched is the page the table reads.
 * @param input - The key prefix, path, request, and optional retry rule and freshness.
 * @returns Query options for `useQuery`, `prefetchQuery` or `useListQuery`.
 */
export function listQueryOptions<T>({
  key,
  path,
  request,
  retry = retryList,
  staleTime,
}: ListQueryInput) {
  return queryOptions({
    queryKey: [...key, 'list', request] as const,
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<ListPage<T>>>(path, {
          params: request.cursor === undefined ? { ...request, total: 1 } : request,
        })
      ),
    /** The previous view's rows stay up, marked busy, while the next view loads. */
    placeholderData: keepPreviousData,
    retry,
    ...(staleTime === undefined ? {} : { staleTime }),
  })
}
