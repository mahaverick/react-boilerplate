import { planRefusalFrom } from '@/lib/plan-refusal'

/**
 * What a refused invite or resend says. The counts and the upgrade path are
 * left to the at-limit note above the invite form, so this does not repeat them.
 */
export const NOT_SENT_AT_LIMIT = 'Not sent. You’re at the members limit.'

/**
 * Whether a failed request is the plan refusing a member for the members
 * limit: a 402 `PLAN_LIMIT_REACHED` for the `members` key, with its counts.
 * @param error - What the request rejected with.
 */
export function isMembersLimitRefusal(error: unknown): boolean {
  const refusal = planRefusalFrom(error)
  return refusal?.kind === 'limit' && refusal.key === 'members'
}
