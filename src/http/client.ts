import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { installInterceptors } from '@/http/interceptors'
import type { ApiSuccess } from '@/types/api.types'

// Relative on purpose. The API has no CORS middleware, so the SPA is served
// same-origin behind a proxy (Vite in dev, nginx in prod). An absolute origin
// here would be blocked by the browser AND would bypass the proxy. Spec
// section 1. `import.meta.env` is typed with an `any` index signature, so the
// assertion is what keeps `any` from leaking into the client's config.
//
// `||`, not `??`: an env file with VITE_API_URL= (empty) is a real deployment
// mistake, and `??` would honour it, giving every request a bare path with no
// /api/v1 prefix and a 404 from the SPA's own index.html.
const baseURL = (import.meta.env.VITE_API_URL as string | undefined) || '/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  // Axios defaults to NO timeout, so a request that never answers — a proxy
  // that accepts the connection and goes quiet, a backend blocked on a lock —
  // hangs forever. Its mutation stays `isPending`, its button stays disabled,
  // and nothing in the UI ever moves again. 30s is well past any healthy
  // request on this API and short enough that a user sees an error instead of
  // a dead page.
  //
  // This is a timeout on the WIRE, not a deadlock guard: the one known
  // deadlock path — a 401 on a refresh request re-entering the very promise it
  // is settling — is closed structurally by `skipAuthRetry` in interceptors.ts,
  // and a timeout would have turned that into a 30s hang rather than a fix.
  timeout: 30_000,
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
