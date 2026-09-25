import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ActivityList } from '@/components/features/activity/activity-list'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, isAuditAction } from '@/constants/audit-actions'
import { canViewActivity } from '@/constants/roles'
import {
  flattenAuditPages,
  useTenantAuditLog,
  type TenantAuditFilters,
} from '@/queries/audit.queries'
import { memberName, useMembers, useMyRole } from '@/queries/tenant.queries'

export const Route = createFileRoute('/_app/tenants/$slug/activity')({
  staticData: { crumb: 'Activity' },
  component: TenantActivityTab,
})

/** The select value meaning "no filter". */
const ANY = 'any'
/** The actor select's "anyone acting under platform access". */
const STAFF = 'staff'

function actionLabel(value: string): string {
  return isAuditAction(value) ? AUDIT_ACTION_LABELS[value] : 'All actions'
}

/**
 * The log and its filters. Its own component so the member list behind the
 * actor filter is only requested once the role check has passed.
 */
function TenantActivity({ slug }: { slug: string }) {
  const [action, setAction] = useState(ANY)
  const [actor, setActor] = useState(ANY)
  const members = useMembers(slug)
  const filters: TenantAuditFilters = {
    action: isAuditAction(action) ? action : undefined,
    actorUserId: actor === ANY || actor === STAFF ? undefined : actor,
    access: actor === STAFF ? 'platform' : undefined,
  }
  const log = useTenantAuditLog(slug, filters, { enabled: true })
  const isFiltered = action !== ANY || actor !== ANY

  function actorLabel(value: string): string {
    if (value === ANY) return 'Anyone'
    if (value === STAFF) return 'Staff'
    const match = members.data?.find((member) => member.user.id === value)
    return match ? memberName(match) : 'A member'
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Select value={action} onValueChange={(value: string | null) => setAction(value ?? ANY)}>
          <SelectTrigger aria-label="Filter by action" className="w-52">
            <SelectValue>{(value: string) => actionLabel(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All actions</SelectItem>
            {AUDIT_ACTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {AUDIT_ACTION_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actor} onValueChange={(value: string | null) => setActor(value ?? ANY)}>
          <SelectTrigger aria-label="Filter by who acted" className="w-52">
            <SelectValue>{(value: string) => actorLabel(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            <SelectItem value={STAFF}>Staff</SelectItem>
            {(members.data ?? []).map((member) => (
              <SelectItem key={member.user.id} value={member.user.id}>
                {memberName(member)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ActivityList
        entries={flattenAuditPages(log.data)}
        isPending={log.isPending}
        isError={log.isError}
        onRetry={() => void log.refetch()}
        hasNextPage={log.hasNextPage}
        isFetchingNextPage={log.isFetchingNextPage}
        onLoadMore={() => void log.fetchNextPage()}
        emptyMessage={
          isFiltered ? 'Nothing matches these filters.' : 'Nothing has happened in this tenant yet.'
        }
      />
    </div>
  )
}

function TenantActivityTab() {
  const { slug } = Route.useParams()
  const { role, isPending, isError, retry } = useMyRole(slug)
  const isAllowed = role !== undefined && canViewActivity(role)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Activity</h2>
        </CardTitle>
        <CardDescription>
          {role !== undefined && !isAllowed
            ? 'Only this tenant’s owners and admins can see its activity.'
            : 'Every change made in this tenant, newest first. What platform staff did is marked Staff.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError || (!isPending && role === undefined) ? (
          <LoadError message={ROLE_ERROR} onRetry={retry} />
        ) : isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isAllowed ? (
          <TenantActivity slug={slug} />
        ) : null}
      </CardContent>
    </Card>
  )
}
