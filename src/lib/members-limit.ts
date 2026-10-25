import { planRefusalFrom } from '@/lib/plan-refusal'
import { nounFor } from '@/lib/plural'

/**
 * The line for a workspace that has reached or passed its members limit.
 * Over the limit it also says how many to remove; at it, it says only to
 * upgrade. Counts include pending invitations, as the API's do.
 * @param used - Members plus pending invitations.
 * @param limit - The plan's member limit.
 * @param plan - The plan's name, such as "Free".
 */
export function membersLimitLine(used: number, limit: number, plan: string): string {
  const members = nounFor(limit, 'members')
  if (used > limit) {
    return `${String(used)} of ${String(limit)} ${members} on ${plan}. Upgrade to add more, or remove ${String(used - limit)}.`
  }
  return `You've used ${String(limit)} of ${String(limit)} ${members} on ${plan}. Upgrade to add more.`
}

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
