import { apiClient, unwrap } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

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
    const refreshResponse =
      await apiClient.post<ApiSuccess<{ accessToken: string }>>('/auth/refresh')
    const { accessToken } = unwrap(refreshResponse)

    // /auth/refresh returns ONLY an access token — no user. The profile
    // call is therefore not optional if the store is to be usable.
    const profileResponse = await apiClient.get<ApiSuccess<User>>('/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    useAuthStore.getState().login(accessToken, unwrap(profileResponse))
    return accessToken
  } catch (error) {
    useAuthStore.getState().logout()
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
