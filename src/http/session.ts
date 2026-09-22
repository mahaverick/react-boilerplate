import { isAxiosError } from 'axios'
import { apiClient, unwrap } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/**
 * Whether the server JUDGED the credentials — the one and only condition that
 * may end a session.
 *
 * **A 401, and nothing else.** Not "the server answered": that is a strictly
 * wider set, and every extra member of it is a way to sign out a user whose
 * session is perfectly good.
 *
 * Verified against the API rather than assumed. `auth.controller.ts`'s refresh
 * handler throws `HttpError(..., 401)` exactly twice — 'Missing refresh token'
 * and 'Account no longer exists or is inactive' — and otherwise answers 200.
 * Every other status on that path comes from something that is not judging
 * anybody:
 *
 * - **5xx.** nginx answers 502/503 through any rolling restart. The SSE
 *   stream errors, as it must, `useNotificationStream` reconnects through
 *   `ensureSession()`, and under an "answered" test that logs out and
 *   redirects — signing out every user with a tab open, on every deploy.
 * - **429.** `/auth/refresh` is rate limited (`auth.routes.ts`), and this hook
 *   calls `ensureSession()` on a schedule across every open tab, so a flapping
 *   network can manufacture the very 429 that would then end the session.
 * - **A malformed 200.** `rejectMalformedJsonResponse` (interceptors.ts)
 *   throws an `AxiosError` that CARRIES a response — a poisoned cache entry or
 *   a misrouted proxy response would otherwise count as an auth verdict.
 * - **No response at all**: a network error, DNS failure, axios timeout or
 *   abort. Nobody said anything about the credentials; the caller simply could
 *   not ask.
 * - **A non-Axios throw** (a bug in this module, say) — same reasoning.
 *
 * Getting this wrong is not hypothetical, and it is not hypothetical in one
 * direction only: this predicate has been too wide twice. Widen it again only
 * with a status the API's own refresh handler actually produces as a judgment
 * on the caller's credentials.
 */
export function isAuthVerdict(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401
}

/**
 * The single in-flight refresh. Every caller — bootstrap, the 401
 * interceptor, and the SSE reconnect path — awaits this same promise.
 *
 * This is not an optimisation. POST /auth/refresh ROTATES the refresh
 * cookie, so a second concurrent call presents an already-consumed token
 * and the backend ends the session. One promise is what prevents that.
 */
let inFlight: Promise<string> | null = null

async function refreshSession(): Promise<string> {
  try {
    // `skipAuthRetry` on both calls below: a 401 on a request made from
    // inside this function must reject, never re-enter ensureSession() — that
    // would await the promise this function is settling. See interceptors.ts.
    const refreshResponse = await apiClient.post<ApiSuccess<{ accessToken: string }>>(
      '/auth/refresh',
      undefined,
      { skipAuthRetry: true }
    )
    const { accessToken } = unwrap(refreshResponse)

    // /auth/refresh returns ONLY an access token — no user. The profile
    // call is therefore not optional if the store is to be usable.
    const profileResponse = await apiClient.get<ApiSuccess<User>>('/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
      skipAuthRetry: true,
    })

    useAuthStore.getState().login(accessToken, unwrap(profileResponse))
    return accessToken
  } catch (error) {
    // ONLY a 401 ends the session. Everything else — 5xx, 429, a malformed
    // 200, no response at all — rejects, so every caller still learns the
    // refresh did not happen, while leaving the store untouched so the next
    // attempt can simply succeed. `inFlight` is cleared by ensureSession's
    // `.finally` either way, so a rejected attempt never wedges the next one.
    // See isAuthVerdict for why this is 401 and not "the server answered".
    if (isAuthVerdict(error)) {
      useAuthStore.getState().logout()
    }
    throw error
  }
}

export function ensureSession(): Promise<string> {
  inFlight ??= refreshSession().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Test-only: drop the cached promise between cases. */
export function resetSessionForTests(): void {
  inFlight = null
}
