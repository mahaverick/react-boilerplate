import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ACCESS_FILTER, ACTION_FILTER } from '@/components/features/activity/activity-filters'
import { ActivityTable } from '@/components/features/activity/activity-table'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { DataTableChip } from '@/components/shared/data-table/data-table-chip'
import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canViewActivity } from '@/constants/roles'
import { statusFrom } from '@/lib/api-error'
import { tenantActivityList, tenantAuditListOptions } from '@/queries/audit.queries'
import { memberName, tenantKeys, useMembers, useMyRole } from '@/queries/tenant.queries'

/**
 * Said both when the cached role statically fails `canViewActivity` and when
 * a fresh request 403s despite it passing: the two read the same to the
 * reader, a role that no longer qualifies.
 */
const OWNERS_AND_ADMINS_MESSAGE = 'Only this tenant’s owners and admins can see its activity.'

/**
 * The log and its filters. Its own component so the member list behind the
 * Actor facet (the tenant's first hundred members by name, `useMembers`) is only
 * requested once the role check has passed; a URL naming someone outside them
 * reads "A member" on its chip. A 403 means
 * the cached role that passed the gate no longer qualifies, so the detail
 * query `useMyRole` reads is invalidated (`exact`, or the log under the same
 * prefix would refetch and 403 again) and the gate re-checks.
 */
function TenantActivity({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const list = useListSearch(tenantActivityList)
  const log = useListQuery(list, (request) => tenantAuditListOptions(slug, request))
  const members = useMembers(slug)
  const forbidden = log.query.isError && statusFrom(log.query.error) === 403

  useEffect(() => {
    if (forbidden) {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug), exact: true })
    }
  }, [forbidden, slug, queryClient])

  /**
   * The member an actor id names, for its chip.
   * @param id - The actor's user id.
   */
  const nameOf = (id: string) => {
    const member = members.data?.find((entry) => entry.user.id === id)
    return member ? memberName(member) : 'A member'
  }
  /** The Actor facet: one member at a time, from the tenant's first hundred members by name. */
  const actorFilter: DataTableFilter = {
    name: 'actor',
    label: 'Actor',
    single: true,
    isPersonal: true,
    options: (members.data ?? []).map((member) => ({
      value: member.user.id,
      label: memberName(member),
    })),
    // The member list's own failure shows in the facet, with a retry.
    optionsState: {
      isPending: members.isPending,
      isError: members.isError,
      retry: () => void members.refetch(),
    },
    renderChip: (value, onRemove) => (
      <DataTableChip prefix="Actor: " value={nameOf(value)} isPersonal onRemove={onRemove} />
    ),
  }

  if (forbidden) {
    return <Note tone="passive">{OWNERS_AND_ADMINS_MESSAGE}</Note>
  }

  return (
    <ActivityTable
      query={log}
      filters={[ACTION_FILTER, actorFilter, ACCESS_FILTER]}
      empty={<EmptyState size="compact" title="Nothing has happened in this tenant yet." />}
    />
  )
}

/**
 * The tab's role gate: loading, failed lookup, not allowed, or the log. The
 * page header already says "Activity" and what the log holds, so the card's
 * title is `sr-only` (the region keeps its heading) and its description only
 * adds what the header does not.
 */
export function TenantActivityPanel({ slug }: { slug: string }) {
  const { role, isPending, isError, retry } = useMyRole(slug)
  const isAllowed = role !== undefined && canViewActivity(role)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="sr-only">Activity</h2>
        </CardTitle>
        <CardDescription>
          {role !== undefined && !isAllowed
            ? OWNERS_AND_ADMINS_MESSAGE
            : 'What platform staff did is marked Staff.'}
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
