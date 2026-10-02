import {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { API_PREFIX } from '@/constants/routes'
import { broadcastLogout, ensureSession, isAuthVerdict, redirectToLogin } from '@/http/session'
import { createTraceparent } from '@/http/traceparent'
import { getAnalyticsSessionId } from '@/observability/analytics'
import { useAuthStore } from '@/states/auth.store'
import { ACCESS_TOKEN_EXPIRED, REAUTH_REQUIRED, type ApiErrorBody } from '@/types/api.types'

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Opts a request out of both the 401 retry path and the 401 verdict path.
     * Set on the two requests refreshSession() makes itself, and on POST
     * /auth/logout so that useLogout alone handles its failure. Without it, a
     * 401 carrying ACCESS_TOKEN_EXPIRED on one of refreshSession()'s requests
     * sends the response interceptor into ensureSession(), which returns the
     * promise awaiting that very request: a self-wait that never settles and
     * never logs out.
     *
     * /profile is behind requireAuth, which emits that code, so this is
     * reachable when a freshly minted token is judged expired (clock skew, a
     * near-zero TTL). /auth/refresh does not emit it, but is marked too: it is
     * rate limited, so recursing into it is wrong regardless.
     */
    skipAuthRetry?: boolean
    /** Set by the response interceptor so a request is replayed at most once. */
    _retried?: boolean
  }
}

/**
 * Rejects a 2xx response whose body is not the JSON object every endpoint
 * promises. Axios parses JSON silently: a 200 carrying an empty body or an
 * HTML page (a poisoned cache entry, a misrouted proxy response) resolves with
 * `response.data` as a raw string, and `unwrap()` then yields `undefined` far
 * from the request. Registered as the second response interceptor, so
 * silent-refresh replays pass through it too. A responseType other than
 * `json` opts out, and an empty body under a non-JSON content-type passes as
 * a no-content response.
 */
export function rejectMalformedJsonResponse(response: AxiosResponse): AxiosResponse {
  const responseType = response.config.responseType
  if (responseType && responseType !== 'json') return response

  if (typeof response.data === 'object' && response.data !== null) return response

  const contentType = String(response.headers['content-type'] ?? '')
  const declaresJson = contentType.includes('json')

  if (!declaresJson && (response.data === '' || response.data === undefined)) return response

  const method = response.config.method?.toUpperCase() ?? 'GET'
  throw new AxiosError(
    `Malformed JSON response body for ${method} ${response.config.url} — ` +
      (declaresJson
        ? 'content-type is JSON but the body did not parse to an object '
        : `expected JSON but got content-type "${contentType}" `) +
      '(corrupted or poisoned browser cache entry, or a misrouted response)',
    'ERR_MALFORMED_RESPONSE',
    response.config,
    response.request,
    response
  )
}

/**
 * Whether `config` is a call to this app's own API: same origin, under
 * `API_PREFIX`. Only those carry the trace and session headers; an absolute
 * URL to anywhere else never does.
 */
function isApiRequest(client: AxiosInstance, config: InternalAxiosRequestConfig): boolean {
  try {
    const url = new URL(client.getUri(config), window.location.origin)
    return url.origin === window.location.origin && url.pathname.startsWith(`${API_PREFIX}/`)
  } catch {
    return false
  }
}

/**
 * Sets `traceparent` on every API request that has none (a replay keeps its
 * original), and `X-POSTHOG-SESSION-ID` when analytics has a session to link,
 * so the server's span and its analytics events join the browser's replay.
 */
export function addTraceHeaders(
  client: AxiosInstance,
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig {
  if (!isApiRequest(client, config)) return config
  if (!config.headers.has('traceparent')) config.headers.set('traceparent', createTraceparent())
  const sessionId = getAnalyticsSessionId()
  if (sessionId) config.headers.set('X-POSTHOG-SESSION-ID', sessionId)
  return config
}

/**
 * Installs `addTraceHeaders`, the bearer-token request interceptor, the 401 handling and
 * `rejectMalformedJsonResponse` on `client`.
 *
 * An Authorization header already on a request wins over the store's token:
 * refreshSession() sets one on its /profile call while the store still holds
 * the stale token, and the replay relies on the same precedence. So anything
 * that sets a default Authorization header (either case) shadows the store's
 * token on every request; the store is the only source of the bearer token.
 *
 * A non-expiry 401 on a request that carried a token is the server's verdict
 * on it and signs every tab out. An ACCESS_TOKEN_EXPIRED 401 refreshes once
 * and replays. When that refresh fails, the user is sent to /login only on an
 * auth verdict (`isAuthVerdict`): any other refresh failure leaves the session
 * intact, and the replay sits outside the catch so its own failure rejects
 * with its own error.
 *
 * A REAUTH_REQUIRED 401 is neither a verdict nor an expiry: the session is
 * fine but signed in too long ago for a destructive staff action, so it
 * rejects untouched, with no refresh and no sign-out, for the caller to handle.
 */
export function installInterceptors(client: AxiosInstance): void {
  client.interceptors.request.use((config) => addTraceHeaders(client, config))
  client.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const config = error.config

      // First: a refresh-internal request must reject plainly, or ensureSession() awaits itself.
      if (config?.skipAuthRetry) {
        return Promise.reject(error)
      }

      // A stale step-up judges the sign-in's age, not the session: no refresh, no sign-out.
      if (error.response?.status === 401 && error.response.data?.code === REAUTH_REQUIRED) {
        return Promise.reject(error)
      }

      const isUnauthorized = error.response?.status === 401
      const isExpired = isUnauthorized && error.response?.data?.code === ACCESS_TOKEN_EXPIRED

      // With no token (the login form), a 401 judged a password, not a session.
      if (isUnauthorized && !isExpired && config?.headers.has('Authorization')) {
        useAuthStore.getState().logout()
        broadcastLogout()
        redirectToLogin()
        return Promise.reject(error)
      }

      // `_retried` stops an endpoint that 401s unconditionally from looping.
      if (!isExpired || !config || config._retried) {
        return Promise.reject(error)
      }

      config._retried = true

      let accessToken: string
      try {
        accessToken = await ensureSession()
      } catch (refreshError) {
        // The same gate refreshSession() logs out on, so a 502 or 429 never bounces a live session.
        if (isAuthVerdict(refreshError)) {
          redirectToLogin()
        }
        throw refreshError
      }

      config.headers.set('Authorization', `Bearer ${accessToken}`)
      return client.request(config)
    }
  )

  client.interceptors.response.use(rejectMalformedJsonResponse)
}
