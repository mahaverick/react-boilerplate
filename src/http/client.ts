import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { API_PREFIX } from '@/constants/routes'
import { installInterceptors } from '@/http/interceptors'
import type { ApiSuccess } from '@/types/api.types'

/**
 * The axios instance every REST call goes through.
 *
 * The base is the relative, fixed `API_PREFIX`: the SPA is served same-origin
 * with the API (Vite's proxy in dev, nginx in prod), the only topology it
 * supports. This client reaches the API through `'self'` alone; any other
 * host in nginx's CSP `connect-src` is one a third-party script, such as a
 * payment provider's, calls for its own traffic. The refresh cookie belongs to
 * whichever origin answers `/api` (with secure cookies and no COOKIE_DOMAIN, a
 * host-only `__Host-` cookie).
 *
 * The 30s timeout exists because axios has none by default, so a request that
 * never answers would leave its mutation pending and its button disabled
 * forever. It is a wire timeout, not a deadlock guard: the refresh self-wait
 * is closed by `skipAuthRetry` (interceptors.ts).
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_PREFIX,
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

/** The payload of a success response: the `data` of the envelope that wraps every success body. */
export function unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T {
  return response.data.data
}

// Import cycle (client → interceptors → session → client): safe, as session.ts reads apiClient only inside functions.
installInterceptors(apiClient)
