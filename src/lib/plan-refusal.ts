import { detailsFrom, codeFrom, statusFrom } from '@/lib/api-error'
import { PLAN_FEATURE_REQUIRED, PLAN_LIMIT_REACHED } from '@/types/api.types'

/** A plan refusing a write: a limit the workspace has reached, or a feature its plan lacks. */
export type PlanRefusal =
  | { kind: 'limit'; key: string; used: number; limit: number }
  | { kind: 'feature'; key: string }

/**
 * The plan refusal a failed request carries, or `undefined` when it is not
 * one: only a 402 with `PLAN_LIMIT_REACHED` and a well-typed
 * `{ key, used, limit }`, or `PLAN_FEATURE_REQUIRED` and `{ key }`. A 402
 * without `details` (an invitee refused on a full workspace) is `undefined`
 * too, since it has no usage to show.
 */
export function planRefusalFrom(error: unknown): PlanRefusal | undefined {
  if (statusFrom(error) !== 402) return undefined
  const code = codeFrom(error)
  const details = detailsFrom(error)
  if (!details || typeof details.key !== 'string') return undefined
  if (code === PLAN_FEATURE_REQUIRED) return { kind: 'feature', key: details.key }
  if (
    code === PLAN_LIMIT_REACHED &&
    typeof details.used === 'number' &&
    typeof details.limit === 'number'
  ) {
    return { kind: 'limit', key: details.key, used: details.used, limit: details.limit }
  }
  return undefined
}
