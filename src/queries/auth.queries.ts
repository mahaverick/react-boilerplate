import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { broadcastLogout, switchIdentity } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, AuthProviders, User } from '@/types/api.types'

/** What `POST /auth/link/verify` answers: the session, whether this click created the account, and the path stored with the link. */
interface LinkSignIn {
  accessToken: string
  user: User
  isNewUser: boolean
  redirect: string | null
}

/** The key of the caller's linked sign-in methods (`useAuthProviders`), under an `auth` prefix of its own. */
export const authKeys = { providers: ['auth', 'providers'] as const }

/**
 * Requests a sign-in link. The API answers 202 whether or not the address has
 * an account, so success says nothing about the address. `redirect` is the
 * same-origin path to land on after signing in; it is left out when absent.
 * No bearer token and no refresh retry: the request is public.
 */
export function useRequestSignInLink() {
  return useMutation({
    mutationFn: async (input: { email: string; redirect?: string }) => {
      await apiClient.post<ApiSuccess<null>>(
        '/auth/link/request',
        { email: input.email, app: 'web', redirect: input.redirect },
        { skipAuthRetry: true, headers: { Authorization: false } }
      )
    },
    onSuccess: () => track('sign_in_link_requested'),
  })
}

/**
 * Signs in with the token from an emailed link, creating the account on the
 * first click. Public like the request, so a stale bearer token is never sent.
 * A different signed-in user is switched out first (`switchIdentity`). The
 * store is signed in before `sign_in_completed` is tracked, so the event
 * carries the new identity.
 */
export function useVerifySignInLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<LinkSignIn>>(
          '/auth/link/verify',
          { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      ),
    onSuccess: ({ accessToken, user }) => {
      switchIdentity(queryClient, user.id)
      useAuthStore.getState().login(accessToken, user)
      track('sign_in_completed', { method: 'link' })
    },
  })
}

/** The sign-in methods linked to the caller's account. */
export function useAuthProviders() {
  return useQuery({
    queryKey: authKeys.providers,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<AuthProviders>>('/auth/providers')),
  })
}

/** What `POST /auth/sessions/revoke-others` answers: how many other sessions it ended. */
export interface RevokedSessions {
  revoked: number
}

/**
 * Signs the caller out everywhere but here: the API revokes every other
 * session of this user and keeps the current one. It sends an empty JSON
 * object, the body the API documents for the route.
 */
export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.post<ApiSuccess<RevokedSessions>>('/auth/sessions/revoke-others', {})),
  })
}

const LOGOUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again."

/** Names the sign-out mutation, so every sign-out control sees one in flight. */
const LOGOUT_KEY = ['auth', 'logout'] as const

/**
 * Whether a sign-out is in flight anywhere, from any control that started it.
 * @returns True while a `useLogout` mutation is pending.
 */
export function useLogoutPending(): boolean {
  return useIsMutating({ mutationKey: LOGOUT_KEY }) > 0
}

/**
 * Signs out server-side first; the local session ends only once the server's
 * has, or the server answers 401 (its session is already over).
 * `returnTo` is the same-origin path to land on afterwards, `/login` by default.
 */
export function useLogout({ returnTo = ROUTES.login }: { returnTo?: string } = {}) {
  const logout = useAuthStore((s) => s.logout)
  /** Ends this tab's session, tells the other tabs, and loads `returnTo` as a full page. */
  const endSession = () => {
    logout()
    broadcastLogout()
    window.location.assign(returnTo)
  }
  return useMutation({
    mutationKey: LOGOUT_KEY,
    // skipAuthRetry: onError below alone decides what a failed logout means.
    mutationFn: async () =>
      apiClient.post<ApiSuccess<unknown>>('/auth/logout', undefined, { skipAuthRetry: true }),
    onSuccess: endSession,
    onError: (error) => {
      // A 401 is taken as the session already over; no response, 5xx or 429 leave it alive.
      if (statusFrom(error) === 401) {
        endSession()
        return
      }
      toast.error(LOGOUT_FAILED_MESSAGE)
    },
  })
}
