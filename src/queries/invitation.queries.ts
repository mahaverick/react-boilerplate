import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import type { AcceptedInvitation, ApiSuccess, InvitationPreview } from '@/types/api.types'

export const invitationKeys = {
  preview: (token: string) => ['invitations', 'preview', token] as const,
}

/**
 * What an invite link opens onto. Public, and asked as a stranger even when
 * someone is signed in: no bearer token is sent (a `false` header makes the
 * request interceptor skip it, and axios drops it from the wire), and
 * `skipAuthRetry` keeps a 401 here from being read as a verdict on the
 * session. A POST with the token in the body, so it stays out of URLs and
 * access logs.
 *
 * A 404 is the answer ("invalid or expired"), so it is not retried; anything
 * else is retried once, as the app's query client does.
 */
export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.preview(token ?? ''),
    queryFn: async () =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationPreview>>(
          '/invitations/preview',
          { token },
          {
            headers: { Authorization: false },
            skipAuthRetry: true,
          }
        )
      ),
    enabled: Boolean(token),
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
  })
}

/**
 * Accepts as the signed-in user. Expected refusals are 403 (wrong or
 * unverified email) and 404 (no longer valid); a 401 here is a real session
 * verdict, handled by the interceptor like any other.
 *
 * On success the tenant's detail is removed, not invalidated, because the
 * route loader's `ensureQueryData` would return a cached 404 `null`. The list
 * refetches with `refetchType: 'all'`, since the accept page does not observe
 * it, and the profile refreshes, since accepting into the platform tenant
 * changes the stored user's platformRole.
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<AcceptedInvitation>>('/invitations/accept', { token })
      ),
    onSuccess: async ({ tenant }) => {
      queryClient.removeQueries({ queryKey: tenantKeys.detail(tenant.slug) })
      await queryClient.invalidateQueries({
        queryKey: tenantKeys.list,
        exact: true,
        refetchType: 'all',
      })
      await refreshProfile(queryClient)
    },
  })
}

/** "Ada Lovelace", or "A teammate" when there is no name on file or no inviter. */
export function inviterName(
  inviter: { firstName: string | null; lastName: string | null } | null
): string {
  return fullName(inviter) ?? 'A teammate'
}
