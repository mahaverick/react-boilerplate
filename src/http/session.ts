import { isAxiosError } from 'axios'
import { apiClient, unwrap } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/**
 * Whether the server actually ANSWERED — as opposed to never having been
 * reached at all.
 *
 * This is the line between "your session is dead" and "I could not ask". A
 * 401 from /auth/refresh is a verdict: the refresh cookie is gone, expired or
 * already rotated, and the only correct response is to clear the session. A
 * network error, a DNS failure, an axios timeout or an aborted request is not
 * a verdict about anything — the session may be perfectly good, and the
 * caller simply could not find out.
 *
 * Treating those the same is not hypothetical: `useNotificationStream` routes
 * every EventSource error through `ensureSession()`, so under the old
 * unconditional `logout()` roughly two seconds of API downtime signed the
 * user out of a working session. That is a worse failure than the one the
 * logout exists to handle.
 *
 * A non-Axios throw (a bug in this module, say) is deliberately NOT a verdict
 * either: nothing about it says the credentials are bad.
 */
export function isServerVerdict(error: unknown): boolean {
  return isAxiosError(error) && error.response !== undefined
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
    // ONLY a verdict from the server ends the session. A transport failure
    // rejects — every caller still learns the refresh did not happen — while
    // leaving the store untouched, so the next attempt can simply succeed.
    // `inFlight` is cleared by ensureSession's `.finally` either way, so a
    // rejected attempt never wedges the next one. See isServerVerdict.
    if (isServerVerdict(error)) {
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
