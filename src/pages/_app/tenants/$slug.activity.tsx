import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
import { statusFrom } from '@/lib/api-error'
import {
  flattenAuditPages,
  useTenantAuditLog,
  type TenantAuditFilters,
} from '@/queries/audit.queries'
import { memberName, tenantKeys, useMembers, useMyRole } from '@/queries/tenant.queries'

export const Route = createFileRoute('/_app/tenants/$slug/activity')({
  staticData: { crumb: 'Activity' },
  component: TenantActivityTab,
})

/** The select value meaning "no filter". */
const ANY = 'any'
/** The actor select's "anyone acting under platform access". */
const STAFF = 'staff'

/**
 * Said both when the cached role statically fails `canViewActivity` and when
 * a fresh request 403s despite it passing: the two read the same to the
 * reader, a role that no longer qualifies.
 */
const OWNERS_AND_ADMINS_MESSAGE = 'Only this tenant’s owners and admins can see its activity.'

function actionLabel(value: string): string {
  return isAuditAction(value) ? AUDIT_ACTION_LABELS[value] : 'All actions'
}

/**
 * The log and its filters. Its own component so the member list behind the
 * actor filter is only requested once the role check has passed.
 */
function TenantActivity({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
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
  // A stale cached role: the tab rendered on a role that passed
  // `canViewActivity`, but the log itself says that role no longer qualifies.
  const forbidden = log.isError && statusFrom(log.error) === 403

  useEffect(() => {
    // `useMyRole` (the tab gate) reads this same key, so invalidating it
    // makes the gate re-check the role rather than keep trusting the stale
    // cached one that got this far. `exact`, or the audit log query under
    // this same prefix would also refetch and 403 again for nothing.
    if (forbidden) {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug), exact: true })
    }
  }, [forbidden, slug, queryClient])

  function actorLabel(value: string): string {
    if (value === ANY) return 'Anyone'
    if (value === STAFF) return 'Staff'
    const match = members.data?.find((member) => member.user.id === value)
    return match ? memberName(match) : 'A member'
  }

  if (forbidden) {
    return <p className="text-sm text-muted-foreground">{OWNERS_AND_ADMINS_MESSAGE}</p>
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
        isFetchNextPageError={log.isFetchNextPageError}
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
            ? OWNERS_AND_ADMINS_MESSAGE
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
