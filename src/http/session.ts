import { isAxiosError } from 'axios'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { identifyUser, resetAnalytics, setAnalyticsOptOut } from '@/observability/analytics'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/**
 * Whether a failed refresh was the server judging the credentials: a 401, and
 * nothing else. It is the only refresh failure that may end a session (other
 * requests: interceptors.ts).
 *
 * The API's refresh answers 401 when the cookie is missing, when rotation
 * rejects the token (unknown, reused outside the grace window, expired, or
 * past the session's absolute lifetime), and when the account is gone or
 * inactive. Every other failure judges nobody, and treating it as a verdict
 * signs out a user whose session is good:
 *
 * - **5xx**: nginx answers 502/503 through a rolling restart, and the SSE
 *   stream reconnects through `ensureSession()`, so every open tab would sign
 *   out on every deploy.
 * - **429**: `/auth/refresh` is rate limited, and the stream calls
 *   `ensureSession()` on a schedule across every tab.
 * - **A malformed 200**: `rejectMalformedJsonResponse` throws an `AxiosError`
 *   that carries a response.
 * - **No response**: a network error, DNS failure, axios timeout or abort.
 * - **A non-Axios throw**, such as a bug in this module.
 *
 * Widen it only with a status the API's refresh produces as a judgment on the
 * caller's credentials.
 */
export function isAuthVerdict(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401
}

/**
 * Move the browser to /login after a session has ended: the one place that
 * navigation is written, for the 401 interceptor (interceptors.ts), the SSE
 * reconnect (`useNotificationStream`) and a logout broadcast from another tab.
 * `_app.beforeLoad` runs only on navigation, so without this a signed-out tab
 * would stay where it was, showing cached data.
 *
 * The caller's `pathname + search + hash` goes into `?redirect=`, as `_app`'s
 * guard does, and `login.tsx` reads it back through `safeRedirect`, which
 * re-validates it. On /login itself there is no redirect target, or signing in
 * would return the user to the login page.
 *
 * A full-page `assign`, not a router navigation: its callers run outside
 * render with no router to hand, and a dead session is the moment to discard
 * all in-memory state. `refreshSession()` does not call it, because
 * `bootstrapSession()` drives a 401 through there on every cold load with a
 * dead cookie, and navigating from there would replace the router guard's
 * client-side redirect with a full page load, and on /login loop.
 */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  const target =
    pathname === ROUTES.login
      ? ROUTES.login
      : `${ROUTES.login}?redirect=${encodeURIComponent(`${pathname}${search}${hash}`)}`
  window.location.assign(target)
}

/** BroadcastChannel name shared by every tab of this app. */
const AUTH_CHANNEL = 'auth'
/** Web Lock name that serialises POST /auth/refresh across tabs. */
const REFRESH_LOCK = 'auth-refresh'

interface AuthMessage {
  type?: string
}

/** One channel per tab, for posting and listening alike: a second instance would hear this tab's own posts. */
let channel: BroadcastChannel | null = null
let uninstallListener: (() => void) | null = null

function authChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(AUTH_CHANNEL)
  return channel
}

/** Tell every other tab this session has ended; a no-op without BroadcastChannel. */
export function broadcastLogout(): void {
  authChannel()?.postMessage({ type: 'logout' } satisfies AuthMessage)
}

/** Sign this tab out when another tab broadcasts a logout; idempotent, returns the cleanup. */
export function installAuthBroadcastListener(): () => void {
  if (uninstallListener) return uninstallListener
  const target = authChannel()
  if (!target) return () => {}

  const onMessage = (event: MessageEvent<AuthMessage | null>) => {
    // A tab already signed out (on /login, say) has nothing to end and must not reload.
    if (event.data?.type !== 'logout' || !useAuthStore.getState().isAuthenticated) return
    useAuthStore.getState().logout()
    redirectToLogin()
  }
  target.addEventListener('message', onMessage)
  uninstallListener = () => {
    target.removeEventListener('message', onMessage)
    uninstallListener = null
  }
  return uninstallListener
}

let uninstallAnalyticsIdentity: (() => void) | null = null

/**
 * Keeps analytics' identity in step with the store's user, whatever changed
 * it: sign-in, the session restore, the 401 verdict, a logout broadcast from
 * another tab, or a refresh that failed with one. A different user, or none,
 * resets first, so the next person's events never carry the last one's
 * distinct id; a user is then identified by id alone after their own opt-out
 * is applied, so an opted-out user's identify is never captured. Idempotent;
 * returns the cleanup.
 */
export function installAnalyticsIdentity(): () => void {
  if (uninstallAnalyticsIdentity) return uninstallAnalyticsIdentity
  const apply = (user: User | null, previous: User | null) => {
    if (previous && previous.id !== user?.id) resetAnalytics()
    if (!user) return
    setAnalyticsOptOut(user.analyticsOptOut === true)
    if (user.id !== previous?.id) identifyUser(user.id)
  }
  apply(useAuthStore.getState().user, null)
  const unsubscribe = useAuthStore.subscribe((state, previousState) => {
    if (state.user !== previousState.user) apply(state.user, previousState.user)
  })
  uninstallAnalyticsIdentity = () => {
    unsubscribe()
    uninstallAnalyticsIdentity = null
  }
  return uninstallAnalyticsIdentity
}

/**
 * The single in-flight refresh. Every caller (bootstrap, the 401 interceptor,
 * the SSE reconnect) awaits this same promise, because POST /auth/refresh
 * rotates the refresh cookie and a second call presents the rotated token.
 * The API answers that with a sibling token within its 10s reuse grace window,
 * and revokes the whole session after it.
 */
let inFlight: Promise<string> | null = null

/**
 * Refreshes the access token and loads the profile into the store: /auth/refresh
 * returns only an access token, so the user comes from /profile. Only an
 * auth verdict (`isAuthVerdict`) signs the store out; any other failure
 * rejects with the store untouched, so the next attempt can succeed. A tab
 * that was never signed in does not broadcast the logout, or it would sign out
 * a sibling tab that just logged in.
 * @returns The new access token.
 * @throws The failure of either request, rethrown.
 */
async function refreshSession(): Promise<string> {
  try {
    // skipAuthRetry on both calls: re-entering ensureSession() here would await this very promise.
    const refreshResponse = await apiClient.post<ApiSuccess<{ accessToken: string }>>(
      '/auth/refresh',
      undefined,
      { skipAuthRetry: true }
    )
    const { accessToken } = unwrap(refreshResponse)

    const profileResponse = await apiClient.get<ApiSuccess<User>>('/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
      skipAuthRetry: true,
    })

    useAuthStore.getState().login(accessToken, unwrap(profileResponse))
    return accessToken
  } catch (error) {
    if (isAuthVerdict(error)) {
      // Read before logout(): a never-signed-in tab must not broadcast and sign out a sibling that just logged in.
      const wasAuthed = useAuthStore.getState().isAuthenticated
      useAuthStore.getState().logout()
      // The cookie is shared, so a verdict from an authed tab holds for every tab.
      if (wasAuthed) broadcastLogout()
    }
    throw error
  }
}

/**
 * Runs the refresh under a Web Lock, so tabs queue: each refresh rotates the
 * shared cookie. Without Web Locks (an insecure context, an old browser) the
 * API's reuse grace window covers concurrent tabs.
 */
function refreshAcrossTabs(): Promise<string> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(REFRESH_LOCK, () => refreshSession())
  }
  return refreshSession()
}

/**
 * Refreshes the session, sharing one in-flight attempt among callers in this
 * tab; the attempt is cleared when it settles, so a rejection never wedges the
 * next one.
 * @returns The new access token.
 */
export function ensureSession(): Promise<string> {
  inFlight ??= refreshAcrossTabs().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Test-only: drop the cached promise, this tab's broadcast channel and the analytics subscription. */
export function resetSessionForTests(): void {
  inFlight = null
  uninstallAnalyticsIdentity?.()
  uninstallListener?.()
  channel?.close()
  channel = null
}
