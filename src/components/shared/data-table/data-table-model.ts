/**
 * @file What every part of the list table shares: the TanStack features and
 * column meta, the faceted filter's shape, and the pure steps the parts use
 * (the next sort, the "Showing" range, a facet's picks, the total's text).
 */
import {
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type Column,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'
import type { AnalyticsKey } from '@/observability/telemetry'
import type { ListTotal } from '@/types/list.types'

/** How a sorted column's directions read aloud: "A to Z", "newest first", "lowest first". */
export const SORT_WORDS = {
  text: { asc: 'A to Z', desc: 'Z to A' },
  date: { asc: 'oldest first', desc: 'newest first' },
  number: { asc: 'lowest first', desc: 'highest first' },
} as const

/** What a column adds to its definition for `DataTable`. */
export interface DataTableColumnMeta {
  /**
   * The API sort keys this column's header steps through, in click order
   * (`['created', '-created']`); a leading `-` is descending. A column
   * without any is not sortable.
   */
  sorts?: readonly string[]
  /** The column's name in `table_sorted`. Required with `sorts`. */
  sortName?: AnalyticsKey
  /** How its directions read in the sort announcement; `text` by default. */
  sortWords?: keyof typeof SORT_WORDS
  /** The column's name where its header is not a string: the column menu and the card labels. */
  label?: string
  /** Row actions: on a card they sit at the bottom, not as a labelled field. */
  actions?: boolean
  /** Classes for the column's cells. */
  className?: string
}

/** The type-only slot that types every column's `meta`; its value is never read. */
const columnMeta: DataTableColumnMeta = {}

/**
 * The features every list table uses: server-side sorting and paging
 * (`manualSorting`, `manualPagination`, so the table never reorders or
 * slices a page) and column visibility. Columns are built against this with
 * `createColumnHelper<DataTableFeatures, Row>()`.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  columnMeta,
})

/** The type of `dataTableFeatures`. */
export type DataTableFeatures = typeof dataTableFeatures

/** A list's column definitions; each column's value type differs, as `createColumnHelper`'s own `columns()` types them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one value type per column, unknown to the array
export type DataTableColumns<T extends RowData> = Array<ColumnDef<DataTableFeatures, T, any>>

/** One built column of a list table. */
export type DataTableColumn<T extends RowData> = Column<DataTableFeatures, T, unknown>

/**
 * A column definition's id as TanStack builds it: its `id`, else its
 * `accessorKey` with dots as underscores, else a string `header`.
 * @param column - The definition.
 * @returns The id, or undefined for a definition TanStack would reject.
 */
export function columnDefId<T extends RowData>(
  column: DataTableColumns<T>[number]
): string | undefined {
  if (column.id !== undefined) return column.id
  if ('accessorKey' in column) return String(column.accessorKey).replaceAll('.', '_')
  return typeof column.header === 'string' ? column.header : undefined
}

/**
 * How a sort key reads aloud: "Created, newest first".
 * @param label - The owning column's display name.
 * @param key - The sort key; a leading `-` is descending.
 * @param words - The column's `sortWords`; `text` by default.
 */
export function sortPhrase(
  label: string,
  key: string,
  words: keyof typeof SORT_WORDS = 'text'
): string {
  return `${label}, ${key.startsWith('-') ? SORT_WORDS[words].desc : SORT_WORDS[words].asc}`
}

/** One option of a faceted filter. */
export interface DataTableFilterOption {
  value: string
  label: string
}

/** A faceted filter's options, when they come from a request of their own. */
export interface DataTableFilterOptionsState {
  isPending: boolean
  isError: boolean
  retry: () => void
}

/** One faceted filter in a list's toolbar, over a filter its `defineList` declares. */
export interface DataTableFilter {
  /** The filter's name in the list definition. */
  name: string
  /** The button's text and the chip's prefix: "Status". */
  label: string
  options: readonly DataTableFilterOption[]
  /** Set when `options` load from a request, so the popover can say it is loading or failed. */
  optionsState?: DataTableFilterOptionsState
  /** For options the server searches: the popover shows a search box and calls this as the reader types. */
  onSearch?: (term: string) => void
  /** Picking a value replaces the last one: a record id, a yes/no. */
  single?: boolean
  /** No button: the URL sets it from a link elsewhere, and only its chip shows. */
  chipOnly?: boolean
  /** Option labels name people, so they are masked in session replay. */
  isPersonal?: boolean
  /** The chip for a value whose name comes from its own request (a user or tenant id). */
  renderChip?: (value: string, onRemove: () => void) => ReactNode
}

/**
 * A column's display name: its string header, else `meta.label`, else its id.
 * @param column - The column.
 */
export function columnLabel<T extends RowData>(column: DataTableColumn<T>): string {
  const { header, meta } = column.columnDef
  return typeof header === 'string' ? header : (meta?.label ?? column.id)
}

/**
 * The next sort a column's header click asks for. It steps through the
 * column's own keys; after its last one it goes back to the list's default
 * sort, unless the default is one of the column's keys, when it wraps.
 * @param sorts - The column's keys, in click order.
 * @param current - The list's effective sort.
 * @param defaultSort - The list's default sort.
 * @returns The sort to apply.
 */
export function nextSort(sorts: readonly string[], current: string, defaultSort: string): string {
  const index = sorts.indexOf(current)
  const first = sorts[0] ?? defaultSort
  if (index === -1) return first
  const following = sorts[index + 1]
  if (following !== undefined) return following
  return sorts.includes(defaultSort) ? first : defaultSort
}

/**
 * A toolbar or pagination control's accessible name: its visible words, then
 * the list it belongs to, so two lists on one page never share a name and the
 * name still starts with what the control shows (WCAG 2.5.3).
 * @param visible - What the control says.
 * @param list - The list's label.
 */
export function controlName(visible: string, list: string): string {
  return `${visible}, ${list}`
}

/**
 * "Showing 21–40": the rows' positions in the view, from the page index this
 * tab recorded. Null when the index is unknown (a URL opened on a later page)
 * or the page is empty.
 * @param pageIndex - The page, from 0, or undefined.
 * @param limit - The page size.
 * @param rowCount - Rows on this page.
 */
export function showingText(
  pageIndex: number | undefined,
  limit: number,
  rowCount: number
): string | null {
  if (pageIndex === undefined || rowCount === 0) return null
  const first = pageIndex * limit + 1
  /** A count in the reader's digits, grouped. */
  const format = (n: number) => n.toLocaleString('en-US')
  return `Showing ${format(first)}–${format(first + rowCount - 1)}`
}

/**
 * The values a checkbox change leaves picked.
 * @param selected - What is picked now.
 * @param value - The option changed.
 * @param checked - Its new state.
 * @param single - Only one value at a time.
 */
export function toggleValue(
  selected: readonly string[],
  value: string,
  checked: boolean,
  single = false
): string[] {
  if (!checked) return selected.filter((entry) => entry !== value)
  if (single) return [value]
  return selected.includes(value) ? [...selected] : [...selected, value]
}

/**
 * "1,240 results", or "1,000+ results" when the API capped the count.
 * @param total - The view's total.
 */
export function totalText(total: ListTotal): string {
  const count = total.count.toLocaleString('en-US')
  if (total.capped) return `${count}+ results`
  return `${count} ${total.count === 1 ? 'result' : 'results'}`
}
