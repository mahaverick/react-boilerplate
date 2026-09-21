import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { ROUTES } from '@/constants/routes'
import { ensureSession } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { ACCESS_TOKEN_EXPIRED, type ApiErrorBody } from '@/types/api.types'

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

export function installInterceptors(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState()
    // An Authorization header already on the config wins. refreshSession()
    // sets one explicitly on its /profile call because the store still holds
    // the STALE token at that point; overwriting it here would make /profile
    // 401 with ACCESS_TOKEN_EXPIRED, which sends this very interceptor back
    // into ensureSession() to await the promise that is awaiting /profile —
    // a permanent self-wait. The replay below relies on the same precedence.
    if (accessToken && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const config = error.config as RetriableConfig | undefined
      const isExpired =
        error.response?.status === 401 && error.response.data?.code === ACCESS_TOKEN_EXPIRED

      // Only an EXPIRED token is retriable. A plain 401 is a real
      // authorisation failure and must reach the caller. `_retried` stops
      // an endpoint that 401s unconditionally from looping.
      if (!isExpired || !config || config._retried) {
        return Promise.reject(error)
      }

      config._retried = true

      let accessToken: string
      try {
        accessToken = await ensureSession()
      } catch (refreshError) {
        // ensureSession has already cleared the store. Only a failed REFRESH
        // reaches here — the replay below is deliberately outside this catch,
        // so an ordinary failure of the retried request (404, 500, a second
        // 401) rejects with its own error instead of bouncing a still-valid
        // session to the login page.
        if (typeof window !== 'undefined') {
          window.location.assign(ROUTES.login)
        }
        // `throw` rather than Promise.reject: identical in an async function,
        // and refreshError is `unknown`, which prefer-promise-reject-errors
        // rightly refuses to let through Promise.reject.
        throw refreshError
      }

      config.headers.set('Authorization', `Bearer ${accessToken}`)
      return client.request(config)
    }
  )
}
