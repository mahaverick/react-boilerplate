import { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import { ROUTES } from '@/constants/routes'
import { ensureSession, isAuthVerdict } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { ACCESS_TOKEN_EXPIRED, type ApiErrorBody } from '@/types/api.types'

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Opts a request out of the 401 retry path entirely. Set on the two
     * requests refreshSession() makes itself. Without it, a 401 carrying
     * ACCESS_TOKEN_EXPIRED on either of them sends the response interceptor
     * into ensureSession(), which returns the promise that is awaiting that
     * very request — a self-wait that never settles and never logs out.
     *
     * /profile is behind requireAuth and auth.middleware.ts does emit that
     * code, so this is reachable whenever a freshly minted token is judged
     * expired: clock skew, a near-zero TTL, a key-rotation race. /auth/refresh
     * cannot currently emit the code, but it is marked too — it is rate
     * limited, so recursing into it is wrong regardless, and the invariant
     * should not rest on a backend property neither side tests.
     */
    skipAuthRetry?: boolean
    /** Set by the response interceptor so a request is replayed at most once. */
    _retried?: boolean
  }
}

/**
 * Rejects a 2xx response whose body is not the JSON object every endpoint
 * promises. Axios parses JSON silently: a 200 carrying an empty body or an
 * HTML error page (a poisoned browser-cache entry, a misrouted proxy
 * response) resolves successfully with `response.data` as a raw string, and
 * `unwrap()`'s `response.data.data` then yields `undefined` — a failure that
 * surfaces far away, naming no request. Registered as a SECOND response
 * interceptor so silent-refresh replays pass through it too.
 */
export function rejectMalformedJsonResponse(response: AxiosResponse): AxiosResponse {
  // Blob/text/arraybuffer consumers opt out by setting responseType.
  const responseType = response.config.responseType
  if (responseType && responseType !== 'json') return response

  // Parsed to an object — the JSON body every endpoint promises.
  if (typeof response.data === 'object' && response.data !== null) return response

  const contentType = String(response.headers['content-type'] ?? '')
  const declaresJson = contentType.includes('json')

  // An empty body under a non-JSON (or absent) content-type is a legitimate
  // no-content response (204-style), not corruption.
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

export function installInterceptors(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState()
    // An Authorization header already on the config wins. refreshSession()
    // sets one explicitly on its /profile call because the store still holds
    // the STALE token at that point; overwriting it here would make /profile
    // 401 with ACCESS_TOKEN_EXPIRED. The replay below relies on the same
    // precedence.
    //
    // The flip side: anything that sets a DEFAULT Authorization header —
    // `apiClient.defaults.headers.common.Authorization`, or a per-request
    // header on any caller — permanently shadows the store's token, silently,
    // because that default is already on the config by the time this runs.
    // AxiosHeaders.has() is case-insensitive, so a lowercase `authorization`
    // shadows it too. The store is the only source of the bearer token; do
    // not set the header anywhere else.
    if (accessToken && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const config = error.config

      // Checked before anything else: a request refreshSession() made itself
      // must fail as a plain rejection, so ensureSession() rejects — and
      // decides for itself whether that warrants a logout — instead of
      // awaiting itself forever.
      if (config?.skipAuthRetry) {
        return Promise.reject(error)
      }

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
        // Only a failed REFRESH reaches here — the replay below is
        // deliberately outside this catch, so an ordinary failure of the
        // retried request (404, 500, a second 401) rejects with its own error
        // instead of bouncing a still-valid session to the login page.
        //
        // `isAuthVerdict` is the SAME gate session.ts uses to decide whether
        // to log out, and it has to be applied here too: ensureSession leaves
        // the session intact whenever the refresh failed for any reason other
        // than a 401 — a deploy's 502, the refresh rate limiter's 429, a
        // poisoned 200, an unreachable API — and navigating to /login anyway
        // would undo that from the other side, throwing the user out of a
        // session that is still perfectly valid. Redirect only when the store
        // was actually cleared.
        if (isAuthVerdict(refreshError) && typeof window !== 'undefined') {
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

  client.interceptors.response.use(rejectMalformedJsonResponse)
}
