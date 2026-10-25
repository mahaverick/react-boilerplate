import { planRefusalFrom } from '@/lib/plan-refusal'

/**
 * The line for a workspace that has reached or passed its members limit.
 * Over the limit it also says how many to remove; at it, it says only to
 * upgrade. Counts include pending invitations, as the API's do.
 * @param used - Members plus pending invitations.
 * @param limit - The plan's member limit.
 * @param plan - The plan's name, such as "Free".
 */
export function membersLimitLine(used: number, limit: number, plan: string): string {
  if (used > limit) {
    return `${String(used)} of ${String(limit)} members on ${plan}. Upgrade to add more, or remove ${String(used - limit)}.`
  }
  return `You've used ${String(limit)} of ${String(limit)} members on ${plan}. Upgrade to add more.`
}

/**
 * The members-limit line a failed invite or resend carries: a 402
 * `PLAN_LIMIT_REACHED` for the `members` key, with the plan's name known.
 * Any other failure is `undefined`, so the caller shows the server's message.
 * @param error - What the request rejected with.
 * @param plan - The plan's name, or `undefined` while the entitlements are unread.
 */
export function membersRefusalLine(error: unknown, plan: string | undefined): string | undefined {
  const refusal = planRefusalFrom(error)
  if (plan === undefined || refusal?.kind !== 'limit' || refusal.key !== 'members') return undefined
  return membersLimitLine(refusal.used, refusal.limit, plan)
}
