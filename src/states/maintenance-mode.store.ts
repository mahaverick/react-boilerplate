import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  isMaintenanceMode,
  MAINTENANCE_MODE,
  type MaintenanceMode,
  type MaintenanceStatus,
  type READ_ONLY_MODE,
} from '@/types/api.types'

interface MaintenanceModeState {
  mode: MaintenanceMode
  /** The owner's message for customers, plain text, or `null` when none is known. */
  message: string | null
  /** When the current mode began, ISO 8601, or `null` when not known. */
  since: string | null
  /**
   * Applies a `Maintenance-Mode` response header. Anything but a known mode
   * (no header, a value an older or newer API sends) changes nothing: an
   * nginx 502 page carries no header and must never end maintenance. A cached
   * response carries the header it was stored with, which may be stale, so the
   * status read sends `Cache-Control: no-cache`. A new mode drops the message and start time, which belonged
   * to the old one, until the status endpoint or a 503 body supplies them.
   */
  setFromHeader: (value: unknown) => void
  /** Applies a `GET /status/maintenance` answer, which is complete. */
  setFromStatus: (status: MaintenanceStatus) => void
  /**
   * Applies a 503 `MAINTENANCE_MODE` or `READ_ONLY_MODE` body. The mode is
   * the body's own when it names one, otherwise the one the code implies.
   */
  setFromError: (code: typeof MAINTENANCE_MODE | typeof READ_ONLY_MODE, body: unknown) => void
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The maintenance mode as this tab last heard it, from any API response's
 * header, a 503 body or the status endpoint. Memory only: a reload starts at
 * `off` and learns the mode from its first response.
 */
export const useMaintenanceModeStore = create<MaintenanceModeState>()((set, get) => ({
  mode: 'off',
  message: null,
  since: null,
  setFromHeader: (value) => {
    if (!isMaintenanceMode(value) || value === get().mode) return
    set({ mode: value, message: null, since: null })
  },
  setFromStatus: ({ mode, message, since }) => {
    set(mode === 'off' ? { mode, message: null, since: null } : { mode, message, since })
  },
  setFromError: (code, body) => {
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const named = fields.mode
    const mode: MaintenanceMode =
      isMaintenanceMode(named) && named !== 'off'
        ? named
        : code === MAINTENANCE_MODE
          ? 'full'
          : 'read_only'
    set({ mode, message: stringOrNull(fields.message), since: stringOrNull(fields.since) })
  },
}))

/** The mode, message and start time, re-rendering only when one of them changes. */
export function useMaintenanceMode(): Pick<MaintenanceModeState, 'mode' | 'message' | 'since'> {
  return useMaintenanceModeStore(
    useShallow((state) => ({ mode: state.mode, message: state.message, since: state.since }))
  )
}
