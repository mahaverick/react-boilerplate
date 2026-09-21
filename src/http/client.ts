import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { installInterceptors } from '@/http/interceptors'
import type { ApiSuccess } from '@/types/api.types'

// Relative on purpose. The API has no CORS middleware, so the SPA is served
// same-origin behind a proxy (Vite in dev, nginx in prod). An absolute origin
// here would be blocked by the browser AND would bypass the proxy. Spec
// section 1. `import.meta.env` is typed with an `any` index signature, so the
// assertion is what keeps `any` from leaking into the client's config.
const baseURL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

/** Strip the success envelope, which every endpoint on this API returns. */
export function unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T {
  return response.data.data
}

// client -> interceptors -> session -> client is a genuine import cycle.
// It is safe because session.ts only dereferences `apiClient` inside async
// function bodies, never at module scope, so nothing reads it while this
// module is still evaluating. The CALL stays at the bottom because it must
// run after `apiClient` is assigned.
installInterceptors(apiClient)
