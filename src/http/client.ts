import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { API_PREFIX } from '@/constants/routes'
import { createApiClient } from '@/http/create-api-client'
import { installInterceptors as installSharedInterceptors } from '@/http/interceptors'
import { broadcastLogout, ensureSession, redirectToLogin } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'

export { unwrap } from '@/http/create-api-client'

/**
 * Whether `config` is a call to this app's own API: same origin, under
 * `API_PREFIX`. Only those carry the trace and analytics-session headers; an
 * absolute URL to anywhere else never does.
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
 * Installs the shared interceptor chain (interceptors.ts) on `client` with this
 * app's ports: the same-origin API check, the session's refresh, and the
 * browser's sign-out (store, every other tab, then /login).
 *
 * Import cycle (client → session → client): each port is a function that
 * reads session.ts's export only when a request runs, never while the modules
 * are still loading.
 */
export function installInterceptors(client: AxiosInstance): void {
  installSharedInterceptors(client, {
    isApiRequest: (config) => isApiRequest(client, config),
    ensureSession: () => ensureSession(),
    signOut: () => {
      useAuthStore.getState().logout()
      broadcastLogout()
      redirectToLogin()
    },
    redirectToLogin: () => {
      redirectToLogin()
    },
  })
}

/**
 * The axios instance every REST call goes through.
 *
 * The base is the relative, fixed `API_PREFIX`: the SPA is served same-origin
 * with the API (Vite's proxy in dev, nginx in prod), the only topology it
 * supports. This client reaches the API through `'self'` alone; any other
 * host in nginx's CSP `connect-src` is one a third-party script, such as a
 * payment provider's, calls for its own traffic. The refresh cookie belongs to
 * whichever origin answers `/api` (with secure cookies and no COOKIE_DOMAIN, a
 * host-only `__Host-` cookie). The timeout and JSON header come from
 * `createApiClient`.
 */
export const apiClient: AxiosInstance = createApiClient({
  baseURL: API_PREFIX,
  withCredentials: true,
})

installInterceptors(apiClient)
