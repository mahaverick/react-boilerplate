import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { ApiSuccess, PlatformTenantPage, PlatformTenantRow } from '@/types/api.types'

export const platformKeys = {
  tenants: (q: string) => ['platform', 'tenants', q] as const,
}

/** How long a tenant search box waits for typing to stop before asking the API. */
export const SEARCH_DEBOUNCE_MS = 250

/** The API's default page; its cap is 50. */
const SEARCH_PAGE_SIZE = 20
/** The API refuses a longer term. */
const MAX_QUERY_LENGTH = 100

/**
 * Every tenant on the platform, for staff: case-insensitive substring of the
 * name or slug, the platform tenant itself excluded by the API.
 *
 * Non-staff get a 404 here, so the caller passes `enabled: false` for them
 * rather than asking. An empty term sends no `q` at all.
 */
export function usePlatformTenantSearch(q: string, { enabled }: { enabled: boolean }) {
  const term = q.trim().slice(0, MAX_QUERY_LENGTH)
  return useInfiniteQuery({
    queryKey: platformKeys.tenants(term),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformTenantPage>>('/platform/tenants', {
          params: { q: term === '' ? undefined : term, cursor: pageParam, limit: SEARCH_PAGE_SIZE },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  })
}

/** Every loaded page of the search, flattened. */
export function flattenTenantPages(
  data: InfiniteData<PlatformTenantPage> | undefined
): PlatformTenantRow[] {
  return data?.pages.flatMap((page) => page.tenants) ?? []
}
