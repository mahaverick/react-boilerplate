import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { MAINTENANCE_POLL_BASE_MS, MAINTENANCE_POLL_JITTER_MS } from '@/constants/maintenance-mode'
import { apiClient, unwrap } from '@/http/client'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { isMaintenanceMode, type ApiSuccess, type MaintenanceStatus } from '@/types/api.types'

export const maintenanceStatusKey = ['maintenance-status'] as const

/**
 * The delay before the next poll while the mode is `full`: the base interval
 * plus up to `MAINTENANCE_POLL_JITTER_MS` of random delay, drawn afresh for
 * each poll.
 * @param random - A source in [0, 1); `Math.random` unless a test pins it.
 */
export function maintenancePollInterval(random: () => number = Math.random): number {
  return MAINTENANCE_POLL_BASE_MS + Math.floor(random() * MAINTENANCE_POLL_JITTER_MS)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * `GET /status/maintenance`, applied to the maintenance store as it lands. A
 * body without a known `mode` rejects, so it can never end maintenance. The
 * endpoint answers `Cache-Control: public, max-age=5`; the request asks past
 * the browser's copy, because a status cached before the mode changed would
 * overwrite the newer mode a response header has just reported. `signal`
 * aborts the request, so a read the query cancelled never reaches the store.
 */
export async function fetchMaintenanceStatus(signal?: AbortSignal): Promise<MaintenanceStatus> {
  const data = unwrap(
    await apiClient.get<ApiSuccess<Partial<Record<keyof MaintenanceStatus, unknown>>>>(
      '/status/maintenance',
      { headers: { 'Cache-Control': 'no-cache' }, signal }
    )
  )
  if (!isMaintenanceMode(data.mode)) throw new Error('The maintenance status names no known mode.')
  const status: MaintenanceStatus = {
    mode: data.mode,
    message: stringOrNull(data.message),
    since: stringOrNull(data.since),
  }
  useMaintenanceModeStore.getState().setFromStatus(status)
  return status
}

/**
 * The public maintenance status, read once when the app starts and polled
 * while the mode is `full`, so the maintenance page notices the end by itself.
 * The interval follows the store, not the query's data, so a failed poll (an
 * nginx 502 mid-deploy, a body that is not JSON) never stops the next one.
 * Not retried: the next poll is the retry.
 */
export function useMaintenanceStatus(): UseQueryResult<MaintenanceStatus> {
  const isFull = useMaintenanceModeStore((state) => state.mode === 'full')
  return useQuery({
    queryKey: maintenanceStatusKey,
    queryFn: ({ signal }) => fetchMaintenanceStatus(signal),
    retry: false,
    refetchInterval: isFull ? () => maintenancePollInterval() : false,
  })
}
