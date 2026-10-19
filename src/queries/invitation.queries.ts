import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { apiClient, unwrap } from '@/http/client'
import { switchIdentity } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { track } from '@/observability/telemetry'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import type { AcceptedInvitation, ApiSuccess, InvitationPreview, User } from '@/types/api.types'

/** The key of an invite link's preview, one entry per token, under an `invitations` prefix of its own. */
export const invitationKeys = {
  preview: (token: string) => ['invitations', 'preview', token] as const,
}

/** What `POST /invitations/verify` answers: the session, whether this click created the account, and the tenant joined. */
interface InvitationSignIn {
  accessToken: string
  user: User
  isNewUser: boolean
  tenant: { name: string; slug: string }
  role: MembershipRole
}

/**
 * Makes a just-joined tenant visible: its detail is removed, not invalidated,
 * because the route loader's `ensureQueryData` would return a cached 404
 * `null`, and the tenant lists refetch with `refetchType: 'all'`, since the
 * accept page does not observe them.
 */
async function refreshJoinedTenant(queryClient: QueryClient, slug: string): Promise<void> {
  queryClient.removeQueries({ queryKey: tenantKeys.detail(slug) })
  await queryClient.invalidateQueries({
    queryKey: tenantKeys.list,
    exact: true,
    refetchType: 'all',
  })
  await queryClient.invalidateQueries({ queryKey: tenantKeys.pages, refetchType: 'all' })
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
 * else is retried once.
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
      await refreshJoinedTenant(queryClient, tenant.slug)
      await refreshProfile(queryClient)
    },
  })
}

/**
 * Accepts an invitation in one click, signed out: the API signs the invitee in
 * (creating the account when the address has none) and joins them. Public like
 * the preview, so a stale bearer token is never sent. The response carries the
 * user, so the profile needs no refresh. A different signed-in user is
 * switched out first (`switchIdentity`). A 404 is the dead invitation.
 */
export function useVerifyInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationSignIn>>(
          '/invitations/verify',
          { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      ),
    onSuccess: async ({ accessToken, user, tenant }) => {
      switchIdentity(queryClient, user.id)
      useAuthStore.getState().login(accessToken, user)
      track('sign_in_completed', { method: 'link' })
      await refreshJoinedTenant(queryClient, tenant.slug)
    },
  })
}

/** "Ada Lovelace", or "A teammate" when there is no name on file or no inviter. */
export function inviterName(
  inviter: { firstName: string | null; lastName: string | null } | null
): string {
  return fullName(inviter) ?? 'A teammate'
}
