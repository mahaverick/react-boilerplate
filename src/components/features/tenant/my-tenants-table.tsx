/**
 * @file The Tenants page's list: each tenant the caller belongs to, with
 * their role and when they joined. A suspended tenant's own routes answer
 * 404, so its name is not a link and a badge says why.
 */
import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Badge } from '@/components/ui/badge'
import { MEMBERSHIP_ROLES, ROLE_LABELS } from '@/constants/roles'
import { formatDate } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import type { TenantWithRole } from '@/queries/tenant.queries'

const column = createColumnHelper<DataTableFeatures, TenantWithRole>()

/** The tenant's name, linked unless it is suspended, over its slug. */
function TenantName({ entry }: { entry: TenantWithRole }) {
  const suspended = entry.tenant.lifecycleState === 'suspended'
  return (
    <div className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        {suspended ? (
          <span className="font-medium">{entry.tenant.name}</span>
        ) : (
          <Link
            to="/tenants/$slug"
            params={{ slug: entry.tenant.slug }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {entry.tenant.name}
          </Link>
        )}
        {suspended && <Badge variant="outline">Suspended</Badge>}
      </span>
      <span className="text-xs text-muted-foreground">/{entry.tenant.slug}</span>
    </div>
  )
}

const columns = column.columns([
  column.accessor((entry) => entry.tenant.name, {
    id: 'name',
    header: 'Name',
    meta: { sorts: ['name'], sortName: analyticsKey('name') },
    cell: ({ row }) => <TenantName entry={row.original} />,
  }),
  column.accessor('role', {
    header: 'Role',
    cell: ({ getValue }) => <Badge variant="secondary">{ROLE_LABELS[getValue()]}</Badge>,
  }),
  column.accessor('joinedAt', {
    header: 'Joined',
    meta: { sorts: ['-joined'], sortName: analyticsKey('joined'), sortWords: 'date' },
    cell: ({ getValue }) => formatDate(getValue(), 'medium') ?? 'Unknown',
  }),
])

/** The Role facet, every role in descending authority. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'role',
    label: 'Role',
    options: MEMBERSHIP_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
  },
]

/** The caller's tenants, through the shared list table. */
export function MyTenantsTable({
  query,
  empty,
  errorMessage,
}: {
  query: ListQueryState<TenantWithRole>
  empty: ReactNode
  /** The page's own load-error copy. */
  errorMessage: string
}) {
  return (
    <DataTable
      columns={columns}
      query={query}
      label="Tenants"
      getRowId={(entry) => entry.tenant.id}
      empty={empty}
      errorMessage={errorMessage}
      search={{ label: 'Search tenants', placeholder: 'Search by name' }}
      filters={FILTERS}
    />
  )
}
