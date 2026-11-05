import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { modeFromHeader, stateFromError, stateFromStatus } from '@/lib/maintenance-state'
import type {
  MAINTENANCE_MODE,
  MaintenanceMode,
  MaintenanceStatus,
  READ_ONLY_MODE,
} from '@/types/api.types'

/** The maintenance mode and the owner's notice for it, with the setters for each way the app hears of a change. */
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
   * status read sends `Cache-Control: no-cache`. A different mode drops the
   * message and start time, which belonged to the old one, until the status
   * endpoint or a 503 body supplies them.
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
    const mode = modeFromHeader(get().mode, value)
    if (mode === null) return
    set({ mode, message: null, since: null })
  },
  setFromStatus: (status) => {
    set(stateFromStatus(status))
  },
  setFromError: (code, body) => {
    set(stateFromError(code, body))
  },
}))

/** The mode, message and start time, re-rendering only when one of them changes. */
export function useMaintenanceMode(): Pick<MaintenanceModeState, 'mode' | 'message' | 'since'> {
  return useMaintenanceModeStore(
    useShallow((state) => ({ mode: state.mode, message: state.message, since: state.since }))
  )
}
