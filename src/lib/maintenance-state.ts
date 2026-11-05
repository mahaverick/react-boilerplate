/**
 * @file The maintenance mode machine: how a response header, a 503 body or
 * the status endpoint's answer becomes the state the maintenance store holds.
 * Pure, so the store and its tests share it.
 */
import { AxiosHeaders, type RawAxiosHeaders } from 'axios'
import { MAINTENANCE_MODE_HEADER } from '@/constants/maintenance-mode'
import {
  isMaintenanceMode,
  MAINTENANCE_MODE,
  type MaintenanceMode,
  type MaintenanceStatus,
  type READ_ONLY_MODE,
} from '@/types/api.types'

/** The mode, the owner's message and when the mode began. */
export interface MaintenanceSnapshot {
  mode: MaintenanceMode
  /** The owner's message for customers, plain text, or `null` when none is known. */
  message: string | null
  /** When the current mode began, ISO 8601, or `null` when not known. */
  since: string | null
}

/** The `Maintenance-Mode` value on a response's headers, matched case-insensitively. */
export function maintenanceHeaderValue(headers: unknown): unknown {
  if (typeof headers !== 'object' || headers === null) return undefined
  return AxiosHeaders.from(headers as RawAxiosHeaders).get(MAINTENANCE_MODE_HEADER)
}

/**
 * The mode a `Maintenance-Mode` header moves to. Anything but a known mode
 * (no header, a value an older or newer API sends) changes nothing, as does
 * the mode already held.
 * @param current - The mode the app holds.
 * @param value - The header's value.
 * @returns The new mode, or `null` when nothing changes.
 */
export function modeFromHeader(current: MaintenanceMode, value: unknown): MaintenanceMode | null {
  if (!isMaintenanceMode(value) || value === current) return null
  return value
}

/** `value` when it is a string, else `null`: a 503 body is untrusted JSON. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The state a 503 `MAINTENANCE_MODE` or `READ_ONLY_MODE` body describes. The
 * mode is the body's own when it names one, otherwise the one the code implies.
 * @param code - The body's error code.
 * @param body - The parsed body, untrusted.
 */
export function stateFromError(
  code: typeof MAINTENANCE_MODE | typeof READ_ONLY_MODE,
  body: unknown
): MaintenanceSnapshot {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const named = fields.mode
  const mode: MaintenanceMode =
    isMaintenanceMode(named) && named !== 'off'
      ? named
      : code === MAINTENANCE_MODE
        ? 'full'
        : 'read_only'
  return { mode, message: stringOrNull(fields.message), since: stringOrNull(fields.since) }
}

/**
 * The state a `GET /status/maintenance` answer describes. It is complete, and
 * `off` carries no message or start time.
 * @param status - The answer.
 */
export function stateFromStatus({ mode, message, since }: MaintenanceStatus): MaintenanceSnapshot {
  return mode === 'off' ? { mode, message: null, since: null } : { mode, message, since }
}
