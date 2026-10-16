/**
 * @file The one list table both apps render every list through: TanStack
 * Table over the vendored `ui/table`, with the toolbar, sortable headers,
 * cursor paging, column choice and stacked cards on a phone. Rows come from
 * the API one page at a time, already sorted and filtered.
 */
import { IconChevronLeft } from '@tabler/icons-react'
import { useTable, type RowData, type SortingState } from '@tanstack/react-table'
import { useMemo, useState, type ReactNode, type RefCallback } from 'react'
import {
  DataTableCards,
  type DataTableCardHelpers,
} from '@/components/shared/data-table/data-table-cards'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import {
  columnDefId,
  columnLabel,
  dataTableFeatures,
  nextSort,
  sortPhrase,
  type DataTableColumns,
} from '@/components/shared/data-table/data-table-model'
import { DataTablePagination } from '@/components/shared/data-table/data-table-pagination'
import { DataTableSortMenu } from '@/components/shared/data-table/data-table-sort-menu'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { EmptyState } from '@/components/shared/empty-state'
import { QueryState } from '@/components/shared/query-state'
import { TableRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { analyticsKey, type AnalyticsKey } from '@/observability/telemetry'
import type { ListPage } from '@/types/list.types'

/** `table_sorted`'s `sort` when the sort menu's "Default order" is chosen: no column owns that key. */
const DEFAULT_ORDER_NAME = analyticsKey('default')

/** The most skeleton rows a loading list shows, whatever its page size. */
const SKELETON_ROWS = 20

/** What `DataTable` takes. */
export interface DataTableProps<T extends RowData> {
  /** The column definitions. Pass a stable array, module-level or memoized: the table model is rebuilt when it changes. */
  columns: DataTableColumns<T>
  /** From `useListQuery`. */
  query: ListQueryState<T>
  /** The table's accessible name, its sr-only caption, and the cards' list name. */
  label: string
  /** Each row's stable id. */
  getRowId: (row: T) => string
  /** What an unfiltered empty list says. */
  empty: ReactNode
  /** The list's own load-error copy; `QueryState`'s `{label} could not be loaded.` without it. */
  errorMessage?: string
  /**
   * Wrap the list in a region named `label` (the default). False renders a
   * plain `div`, for a parent that is already the list's named region.
   */
  landmark?: boolean
  /** A phone card for one row, in place of the one built from the columns; `helpers.target` registers it as the row's focus landmark when `rowTarget` is given. */
  card?: (row: T, helpers: DataTableCardHelpers) => ReactNode
  /** `cards` stacks cards at every width. */
  layout?: 'table' | 'cards'
  /** The list's own toolbar controls: a date range, the primary action. */
  toolbar?: ReactNode
  /**
   * Registers each row (or card) as a focus landmark by row id
   * (`useFocusAfter`'s `target`), so focus can land on a row once an action
   * replaced the control that had it.
   */
  rowTarget?: (id: string) => RefCallback<HTMLElement>
}

/**
 * A list, in a region named by `label` (so a page with two lists can tell
 * their controls apart): toolbar, then the states `QueryState` renders (a table-shaped
 * skeleton, a refusal, a load error with Try again, an empty state, or the
 * rows), then paging. The rows render as a table, or as cards below 768 px
 * or with `layout="cards"`, never both. A page of the previous view stays up,
 * marked busy, while the next view loads; while that page is empty the
 * skeleton shows, so "nothing matches" never describes the wrong view.
 */
export function DataTable<T extends RowData>({
  columns,
  query,
  label,
  getRowId,
  empty,
  errorMessage,
  landmark = true,
  card,
  layout = 'table',
  toolbar,
  rowTarget,
}: DataTableProps<T>) {
  const { list } = query
  const isMobile = useIsMobile()
  const [announcement, setAnnouncement] = useState('')
  const defaultSort = list.definition.sorts[0]
  const sortColumn = columns.find((column) => column.meta?.sorts?.includes(list.values.sort))
  const sortId = sortColumn === undefined ? undefined : columnDefId(sortColumn)
  const sorting = useMemo<SortingState>(
    () => (sortId === undefined ? [] : [{ id: sortId, desc: list.values.sort.startsWith('-') }]),
    [sortId, list.values.sort]
  )

  // The first column, and any column that opts out, stays visible whatever `?hidden=` says.
  const hideable = new Set(
    columns
      .slice(1)
      .filter((column) => column.enableHiding !== false)
      .map((column) => columnDefId(column))
      .filter((id) => id !== undefined)
  )
  const hiddenKey = list.values.hidden.filter((id) => hideable.has(id)).join(',')
  const columnVisibility = useMemo(
    () => Object.fromEntries(hiddenKey === '' ? [] : hiddenKey.split(',').map((id) => [id, false])),
    [hiddenKey]
  )
  // The first column is the row's name: it is never hideable.
  const tableColumns = useMemo(
    () =>
      columns.map((column, index) => (index === 0 ? { ...column, enableHiding: false } : column)),
    [columns]
  )
  const pagination = useMemo(
    () => ({ pageIndex: list.pageIndex ?? 0, pageSize: list.values.limit }),
    [list.pageIndex, list.values.limit]
  )

  const table = useTable({
    features: dataTableFeatures,
    columns: tableColumns,
    data: query.items,
    getRowId,
    manualSorting: true,
    manualPagination: true,
    pageCount: -1,
    state: { sorting, columnVisibility, pagination },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater
      list.setHidden(Object.keys(next).filter((id) => next[id] === false))
    },
  })

  const sortable = table.getAllLeafColumns().filter((column) => column.columnDef.meta?.sorts)
  /** The column whose header steps through `key`. */
  const ownerOf = (key: string) =>
    sortable.find((candidate) => candidate.columnDef.meta?.sorts?.includes(key))

  /**
   * Sorts by `key` and says so in the live region; the current sort is a no-op.
   * `clickedName` is the column the user acted on, named in `table_sorted`
   * (a header click that returns to the default order is still that column's); the
   * key's own column, then, is named when nothing was clicked.
   */
  const sortTo = (key: string, clickedName?: AnalyticsKey) => {
    if (key === list.values.sort) return
    const owner = ownerOf(key)
    const name = clickedName ?? owner?.columnDef.meta?.sortName
    if (name === undefined) return
    list.setSort(key, name)
    setAnnouncement(
      owner
        ? `Sorted by ${sortPhrase(columnLabel(owner), key, owner.columnDef.meta?.sortWords)}`
        : 'Sorted in the default order'
    )
  }

  /** A header click: the column's next key. */
  const sortBy = (columnId: string) => {
    const meta = table.getColumn(columnId)?.columnDef.meta
    if (!meta?.sorts || !meta.sortName) return
    sortTo(nextSort(meta.sorts, list.values.sort, defaultSort), meta.sortName)
  }

  /** The phone sort menu's choices: every sortable column's keys, plus the default order when no column owns it. */
  const sortOptions = sortable.flatMap((column) =>
    (column.columnDef.meta?.sorts ?? []).map((key) => ({
      key,
      label: sortPhrase(columnLabel(column), key, column.columnDef.meta?.sortWords),
    }))
  )
  if (sortable.length > 0 && ownerOf(defaultSort) === undefined) {
    sortOptions.unshift({ key: defaultSort, label: 'Default order' })
  }

  const visibleColumns = table.getVisibleLeafColumns().length
  // The section template has no live region of its own; the list's loading state is this one.
  const skeleton = (
    <div role="status" aria-label="Loading">
      <TableRowsSkeleton
        rows={Math.min(list.values.limit, SKELETON_ROWS)}
        columns={visibleColumns}
      />
    </div>
  )
  const emptyState =
    list.values.cursor !== undefined ? (
      <EmptyState
        title="Nothing on this page."
        description="The list changed since this page was opened."
        action={
          <Button variant="outline" size="sm" onClick={() => list.firstPage()}>
            <IconChevronLeft aria-hidden="true" />
            First page
          </Button>
        }
      />
    ) : list.isFiltered ? (
      <EmptyState
        title="Nothing matches these filters."
        action={
          <Button variant="outline" size="sm" onClick={list.reset}>
            Reset
          </Button>
        }
      />
    ) : (
      empty
    )

  /** The rows of a settled page, as a table or as cards. */
  const rows = (data: ListPage<T>) => {
    if (data.items.length === 0) return skeleton
    if (layout === 'cards' || isMobile) {
      return (
        <>
          {sortOptions.length > 0 && (
            <DataTableSortMenu
              options={sortOptions}
              value={list.values.sort}
              onSort={(key) => sortTo(key, ownerOf(key) ? undefined : DEFAULT_ORDER_NAME)}
            />
          )}
          <DataTableCards table={table} label={label} card={card} rowTarget={rowTarget} />
        </>
      )
    }
    return (
      <Table aria-label={label}>
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    {meta?.sorts ? (
                      <DataTableColumnHeader
                        label={columnLabel(header.column)}
                        sorted={sorted}
                        onSort={() => sortBy(header.column.id)}
                      />
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              ref={rowTarget?.(row.id)}
              tabIndex={rowTarget === undefined ? undefined : -1}
              className={rowTarget === undefined ? undefined : 'outline-none'}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  // A region named for the list, unless the parent already is one.
  const Frame = landmark ? 'section' : 'div'
  return (
    <Frame aria-label={landmark ? label : undefined} className="grid min-w-0 gap-3">
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      <QueryState
        query={query.query}
        name={label}
        errorMessage={errorMessage}
        skeleton={skeleton}
        isEmpty={(data) => data.items.length === 0 && !query.query.isPlaceholderData}
        empty={emptyState}
      >
        {(data) => (
          <div className="grid gap-3">
            {rows(data)}
            <DataTablePagination
              label={label}
              page={data.page}
              // No position while the old rows are up; the edge-page answers read as 0 (first) or unknown (last, reached backwards).
              pageIndex={
                query.query.isPlaceholderData
                  ? undefined
                  : !data.page.hasPrev
                    ? 0
                    : list.values.direction === 'prev' && !data.page.hasNext
                      ? undefined
                      : list.pageIndex
              }
              limit={list.values.limit}
              rowCount={data.items.length}
              busy={query.query.isPlaceholderData}
              onPrev={() => list.prev(data.page)}
              onNext={() => list.next(data.page)}
              onLimit={list.setLimit}
            />
          </div>
        )}
      </QueryState>
      {query.query.isError && list.values.cursor !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => list.firstPage()}
        >
          <IconChevronLeft aria-hidden="true" />
          First page
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Frame>
  )
}
