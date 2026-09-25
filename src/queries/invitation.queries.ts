import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import type { AcceptedInvitation, ApiSuccess, InvitationPreview } from '@/types/api.types'

export const invitationKeys = {
  preview: (token: string) => ['invitations', 'preview', token] as const,
}

/**
 * What an invite link opens onto. Public, and asked as a stranger even when
 * someone is signed in: no bearer token is sent, and `skipAuthRetry` keeps a
 * 401 here from ever being read as a verdict on the session. A POST with the
 * token in the body, so it stays out of URLs and access logs.
 *
 * A 404 is the answer ("invalid or expired"), not a failure, so it is not
 * retried. Anything else is retried once, as the router's client does.
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
            // `false` makes the request interceptor skip the header, and axios
            // drops a `false` header from the wire.
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
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<AcceptedInvitation>>('/invitations/accept', { token })
      ),
    onSuccess: async ({ tenant }) => {
      // Removed, not invalidated: the tenant route's loader uses
      // `ensureQueryData`, which hands back a cached pre-membership `null`
      // (a 404 from before) without refetching. The prefix also drops this
      // tenant's invitations list. `refetchType: 'all'`: nothing on the accept
      // page observes the list, and a plain invalidation refetches only active queries.
      queryClient.removeQueries({ queryKey: tenantKeys.detail(tenant.slug) })
      await queryClient.invalidateQueries({
        queryKey: tenantKeys.list,
        exact: true,
        refetchType: 'all',
      })
      // Accepting can change the caller's platformRole (the platform tenant
      // is a tenant like any other) — always refresh, rather than special-case
      // it, so `useAuthStore`'s copy is never stale until reload.
      await refreshProfile(queryClient)
    },
  })
}

/** "Ada Lovelace", or "A teammate" when there is no name on file or no inviter. */
export function inviterName(
  inviter: { firstName: string | null; lastName: string | null } | null
): string {
  const full = [inviter?.firstName, inviter?.lastName].filter(Boolean).join(' ').trim()
  return full || 'A teammate'
}
