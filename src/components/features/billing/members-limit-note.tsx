import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import { Note } from '@/components/shared/note'
import { membersLimitLine } from '@/lib/members-limit'
import { useEntitlements } from '@/queries/billing.queries'

/**
 * A warning above the invite form when members plus pending invitations have
 * reached the plan's limit, with the upgrade path the viewer may take. It
 * renders nothing below the limit or while the entitlements are unread. The
 * form stays enabled either way: the API is the guard, and a stale count must
 * not block a valid invite.
 */
export function MembersLimitNote({ slug }: { slug: string }) {
  const entitlements = useEntitlements(slug).data
  const usage = entitlements?.limits.members
  if (!entitlements || !usage || usage.limit === null || usage.used < usage.limit) return null
  return (
    <Note tone="warning">
      <div className="flex flex-wrap items-center gap-3">
        <span>{membersLimitLine(usage.used, usage.limit, entitlements.plan.name)}</span>
        <UpgradeAction slug={slug} surface="limit" entitlementKey="members" />
      </div>
    </Note>
  )
}
