/**
 * @file A tenant's audit log as a table: when, who, what happened and what
 * it happened to. The time shows relative, with the absolute time in a
 * tooltip and, since Base UI's tooltip is not announced, in the cell's own
 * visually hidden text.
 */
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { auditTargetLabel } from '@/components/features/activity/activity-filters'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { actorName, auditSentence } from '@/constants/audit-actions'
import { useNow } from '@/hooks/use-now'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import { analyticsKey } from '@/observability/telemetry'
import type { AuditEntry } from '@/types/api.types'

/**
 * The entry's time, relative, with the absolute time in a tooltip and in hidden text.
 * @param props - The entry's ISO time.
 * @param props.occurredAt - When the entry was recorded.
 */
function When({ occurredAt }: { occurredAt: string }) {
  const now = useNow()
  const absolute = absoluteTime(occurredAt)
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
        <time dateTime={occurredAt}>{relativeTime(occurredAt, now)}</time>
        <span className="sr-only">, {absolute}</span>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  )
}

const column = createColumnHelper<DataTableFeatures, AuditEntry>()

const columns = column.columns([
  column.accessor('occurredAt', {
    header: 'When',
    meta: {
      sorts: ['-occurred', 'occurred'],
      sortName: analyticsKey('occurred'),
      sortWords: 'date',
    },
    cell: ({ getValue }) => <When occurredAt={getValue()} />,
  }),
  column.accessor('actor', {
    header: 'Actor',
    cell: ({ row }) => {
      const { actor, access } = row.original
      return (
        <span className="grid gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Pii className="font-medium">{actorName(actor)}</Pii>
            {access === 'platform' && <Badge variant="outline">Staff</Badge>}
          </span>
          {actor && actor.name !== actor.email && (
            <Pii className="text-xs break-all text-muted-foreground">{actor.email}</Pii>
          )}
        </span>
      )
    },
  }),
  column.display({
    id: 'action',
    header: 'Action',
    cell: ({ row }) => <span className="whitespace-normal">{auditSentence(row.original)}</span>,
  }),
  column.accessor('target', {
    header: 'Target',
    cell: ({ getValue }) => {
      const target = getValue()
      return target ? (
        auditTargetLabel(target.type)
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  }),
])

/** The activity did not load; the reader must not read an empty table as "nothing happened". */
const ACTIVITY_ERROR = 'We couldn’t load the activity, so none is listed. Try again to load it.'

/**
 * A tenant's activity, through the shared list table.
 * @param props - The list query, the empty state and the facets.
 * @param props.query - From `useListQuery`.
 * @param props.empty - Shown when the log has no entries and no filter is set.
 * @param props.filters - The facets: `ACTION_FILTER`, the page's Actor facet and `ACCESS_FILTER`.
 */
export function ActivityTable({
  query,
  empty,
  filters,
}: {
  query: ListQueryState<AuditEntry>
  empty: ReactNode
  filters: readonly DataTableFilter[]
}) {
  return (
    <DataTable
      columns={columns}
      query={query}
      label="Activity"
      errorMessage={ACTIVITY_ERROR}
      getRowId={(entry) => entry.id}
      empty={empty}
      search={{ label: 'Search activity', placeholder: 'Search by email or action' }}
      filters={filters}
    />
  )
}
