/**
 * @file The app's side of maintenance mode: the response interceptor that
 * keeps the maintenance store in step with every API answer, the recovery
 * that runs when `full` ends, and the once-per-period analytics mark.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { AxiosHeaders, isAxiosError, type AxiosInstance, type RawAxiosHeaders } from 'axios'
import { MAINTENANCE_MODE_HEADER, MAINTENANCE_VIEWED_KEY } from '@/constants/maintenance-mode'
import { ensureSession } from '@/http/session'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { MAINTENANCE_MODE, READ_ONLY_MODE } from '@/types/api.types'

/** The `Maintenance-Mode` value on a response's headers, matched case-insensitively. */
function headerValue(headers: unknown): unknown {
  if (typeof headers !== 'object' || headers === null) return undefined
  return AxiosHeaders.from(headers as RawAxiosHeaders).get(MAINTENANCE_MODE_HEADER)
}

/**
 * Reads every response `client` returns, success or failure, into the
 * maintenance store: the `Maintenance-Mode` header, and a 503's
 * `MAINTENANCE_MODE` or `READ_ONLY_MODE` body. Registered after
 * `installInterceptors`, so it sees what the 401 handling and the malformed
 * body check pass on, a silent-refresh replay's answer included. It never
 * changes the outcome: a failure still rejects with its own error.
 */
export function installMaintenanceModeInterceptor(client: AxiosInstance): void {
  const store = () => useMaintenanceModeStore.getState()
  client.interceptors.response.use(
    (response) => {
      store().setFromHeader(headerValue(response.headers))
      return response
    },
    (error: unknown) => {
      if (isAxiosError<unknown>(error) && error.response) {
        const { status, headers } = error.response
        const data = error.response.data
        store().setFromHeader(headerValue(headers))
        const code =
          typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : undefined
        if (status === 503 && (code === MAINTENANCE_MODE || code === READ_ONLY_MODE)) {
          store().setFromError(code, data)
        }
      }
      throw error
    }
  )
}

/**
 * When `full` ends, puts the user back where they were. The session is
 * re-validated first: a page loaded during `full` could not finish its
 * restore, since the refresh succeeded but the profile read was refused, so
 * the store holds no user. `ensureSession` signs the store out only on an
 * auth verdict; any other failure leaves it as it is. Then every route
 * guard and loader runs again against the real session, on the URL the user
 * never left, and every query refetches. Returns the cleanup.
 * @param router - The app's router.
 * @param queryClient - The client holding the page's queries.
 */
export function installMaintenanceRecovery(
  router: AnyRouter,
  queryClient: QueryClient
): () => void {
  return useMaintenanceModeStore.subscribe((state, previous) => {
    if (previous.mode !== 'full' || state.mode === 'full') return
    void ensureSession()
      .catch(() => undefined)
      .then(() => router.invalidate())
      .then(() => queryClient.invalidateQueries())
  })
}

/** In-memory marks, so a tab without `sessionStorage` still reports once. */
const viewed = new Set<string>()

/**
 * Marks a maintenance period, identified by its `since`, as reported in this
 * tab session.
 * @param since - When the period began, as the API sent it.
 * @returns `true` the first time a period is marked, `false` after.
 */
export function markMaintenanceViewed(since: string): boolean {
  if (viewed.has(since)) return false
  viewed.add(since)
  try {
    if (window.sessionStorage.getItem(MAINTENANCE_VIEWED_KEY) === since) return false
    window.sessionStorage.setItem(MAINTENANCE_VIEWED_KEY, since)
  } catch {
    // Storage is best effort: the in-memory mark still dedupes this page load.
  }
  return true
}

/** Test-only: forget every in-memory mark. */
export function resetMaintenanceViewedForTests(): void {
  viewed.clear()
}
