/**
 * @file The axios client factory and the success-envelope reader every app
 * shares. Each app's `client.ts` builds its one instance from here.
 */
import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import type { ApiSuccess } from '@/types/api.types'

/**
 * An axios instance against `baseURL`, with a JSON `Content-Type` and a 30s
 * timeout.
 *
 * The 30s timeout exists because axios has none by default, so a request that
 * never answers would leave its mutation pending and its button disabled
 * forever. It is a wire timeout, not a deadlock guard: the refresh self-wait
 * is closed by `skipAuthRetry` (interceptors.ts).
 * @param options - Where the API is, and whether requests carry cookies.
 * @param options.baseURL - The API's base URL.
 * @param options.withCredentials - Whether requests carry the refresh cookie.
 * @returns The configured instance, with no interceptors installed.
 */
export function createApiClient({
  baseURL,
  withCredentials,
}: {
  baseURL: string
  withCredentials: boolean
}): AxiosInstance {
  return axios.create({
    baseURL,
    withCredentials,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The payload of a success response: the `data` of the envelope that wraps every success body. */
export function unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T {
  return response.data.data
}
