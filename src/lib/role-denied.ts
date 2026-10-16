/**
 * @file Whether a failed read was refused for the caller's role, which
 * `QueryState` shows as `RoleDenied` rather than a retryable error.
 */
import { statusFrom } from '@/lib/api-error'

/**
 * Whether a tenant route refused the caller's role: express answers 403
 * `Insufficient permissions` when the caller's role in the tenant is below the
 * route's. A 404 is a missing or inaccessible tenant, which the pages handle
 * themselves.
 * @param error - A query or mutation error.
 * @returns True for a 403.
 */
export function isRoleDenied(error: unknown): boolean {
  return statusFrom(error) === 403
}
