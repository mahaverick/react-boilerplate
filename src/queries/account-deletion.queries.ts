import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { ApiSuccess, DeletionRequest } from '@/types/api.types'

/** The key of the caller's open deletion request, which the request mutation writes its answer into. */
export const accountDeletionKeys = { request: ['account', 'deletion-request'] as const }

/**
 * `GET /account/deletion-request`: the open request, or null. The API wraps it
 * as `{ request }`, unlike the POST, which answers the bare request.
 */
export function deletionRequestQueryOptions() {
  return queryOptions({
    queryKey: accountDeletionKeys.request,
    queryFn: async ({ signal }): Promise<DeletionRequest | null> =>
      unwrap(
        await apiClient.get<ApiSuccess<{ request: DeletionRequest | null }>>(
          '/account/deletion-request',
          { signal }
        )
      ).request,
  })
}

/**
 * `POST /account/deletion-request { reason? }`. It needs a recent sign-in, so a
 * caller runs it through `useStepUp().run`. The API answers 201 for a new
 * request and 200 for the one already open; either way the returned request
 * lands in the cache.
 */
export function useRequestAccountDeletion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { reason?: string }) =>
      unwrap(await apiClient.post<ApiSuccess<DeletionRequest>>('/account/deletion-request', input)),
    onSuccess: (request) => {
      queryClient.setQueryData(accountDeletionKeys.request, request)
    },
  })
}
