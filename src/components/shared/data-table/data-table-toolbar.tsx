import { IconLayoutColumns } from '@tabler/icons-react'
import { useRouter } from '@tanstack/react-router'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { DataTableChip } from '@/components/shared/data-table/data-table-chip'
import { DataTableFacetedFilter } from '@/components/shared/data-table/data-table-faceted-filter'
import {
  columnLabel,
  controlName,
  totalText,
  type DataTableFeatures,
  type DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListSearchState } from '@/components/shared/data-table/use-list-search'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cleanSearch } from '@/schemas/list-request.schemas'
import { LIST_SEARCH_DEBOUNCE_MS, MAX_SEARCH_LENGTH, type ListTotal } from '@/types/list.types'

/**
 * The search box: debounced into `?search=`. A term set from outside the box
 * (the palette, Back) fills it, and the debounce still pending for the text it
 * replaces is cancelled. A URL
 * change is the box's own echo only when it equals the last term the box wrote
 * or the cleaned draft; the box may hold newer keystrokes then, and keeps them.
 * Nothing is written while an IME composition is active.
 */
function DataTableSearch({
  list,
  label,
  placeholder,
}: {
  list: ListSearchState
  label: string
  placeholder?: string
}) {
  const current = list.values.search
  const [draft, setDraft] = useState(current)
  const [followed, setFollowed] = useState(current)
  const [written, setWritten] = useState<string | undefined>(undefined)
  const [composing, setComposing] = useState(false)
  const [pops, setPops] = useState(0)
  const [seenPops, setSeenPops] = useState(0)
  const { history } = useRouter()
  const apply = useEffectEvent((value: string) => {
    setWritten(cleanSearch(value))
    list.setSearch(value)
  })

  if (current !== followed) {
    setFollowed(current)
    // The cleaned draft too: an outside change that lands on exactly the term the pending draft cleans to (the reader typed "acme " as the palette set "acme") keeps the reader's raw text.
    if (current !== written && current !== cleanSearch(draft)) {
      setDraft(current)
      setWritten(undefined)
    }
  }

  // Back, Forward and go() restore an entry as it was, so a keystroke pending for the entry being left must not be written over it, even when both entries hold the same term.
  useEffect(
    () =>
      history.subscribe(({ action }) => {
        if (action.type === 'BACK' || action.type === 'FORWARD' || action.type === 'GO') {
          setPops((count) => count + 1)
        }
      }),
    [history]
  )
  if (pops !== seenPops) {
    setSeenPops(pops)
    setDraft(current)
    setWritten(undefined)
  }

  // The debounce: a change to the draft (typed, or taken from outside) cancels the write pending for the old one.
  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => apply(draft), LIST_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, composing])

  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      className="w-full sm:w-72"
      maxLength={MAX_SEARCH_LENGTH}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      // Some keyboards drop focus mid-composition without reporting its end.
      onBlur={() => setComposing(false)}
    />
  )
}

/** The column menu: a checkbox per column the reader may hide (never the first). */
function DataTableColumnMenu<T extends RowData>({
  list,
  table,
}: {
  list: string
  table: ReactTable<DataTableFeatures, T>
}) {
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide())
  if (hideable.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" aria-label={controlName('Columns', list)} />}
      >
        <IconLayoutColumns aria-hidden="true" />
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show columns</DropdownMenuLabel>
          {hideable.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(checked: boolean) => column.toggleVisibility(checked)}
            >
              {columnLabel(column)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A list's toolbar: search, a faceted button per filter, the list's own
 * controls (`children`: a date range, the primary action), the total, the
 * card layout's sort menu and the column menu; under them, a chip per applied
 * value and Reset.
 */
export function DataTableToolbar<T extends RowData>({
  label,
  list,
  table,
  filters,
  search,
  total,
  totalPending,
  showColumns,
  sortMenu,
  children,
}: {
  /** The list's label, which names the toolbar's controls apart from another list's. */
  label: string
  list: ListSearchState
  table: ReactTable<DataTableFeatures, T>
  filters: readonly DataTableFilter[]
  search?: { label: string; placeholder?: string }
  /** The view's total; absent while a new view's first page loads, so it never shows a stale count. */
  total: ListTotal | undefined
  /** The page is loading, so a total may still arrive. */
  totalPending: boolean
  /** False when the cards do not follow the column choice (a list's own `card`). */
  showColumns: boolean
  /** The sort menu of the card layout, which has no column headers. */
  sortMenu?: ReactNode
  children?: ReactNode
}) {
  const chips = filters.flatMap((filter) =>
    (list.values.filters[filter.name] ?? []).map((value) => {
      const remaining = (list.values.filters[filter.name] ?? []).filter((entry) => entry !== value)
      /** Drops this value from its filter. */
      const onRemove = () => list.setFilter(filter.name, remaining)
      const key = `${filter.name}:${value}`
      if (filter.renderChip) return <span key={key}>{filter.renderChip(value, onRemove)}</span>
      const label = filter.options.find((option) => option.value === value)?.label ?? value
      return (
        <DataTableChip
          key={key}
          prefix={`${filter.label}: `}
          value={label}
          isPersonal={filter.isPersonal}
          onRemove={onRemove}
        />
      )
    })
  )
  const facets = filters.filter((filter) => !filter.chipOnly)
  const hasColumnMenu =
    showColumns && table.getAllLeafColumns().some((column) => column.getCanHide())
  if (
    !search &&
    facets.length === 0 &&
    !children &&
    !sortMenu &&
    !hasColumnMenu &&
    !total &&
    !totalPending &&
    !list.isFiltered
  ) {
    return null
  }
  return (
    <div data-slot="data-table-toolbar" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <DataTableSearch list={list} label={search.label} placeholder={search.placeholder} />
        )}
        {facets.map((filter) => (
          <DataTableFacetedFilter
            list={label}
            key={filter.name}
            filter={filter}
            selected={list.values.filters[filter.name] ?? []}
            onChange={(values) => list.setFilter(filter.name, values)}
          />
        ))}
        {children}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Always mounted, so a screen reader announces the text when it changes. */}
          <p role="status" className="text-sm text-muted-foreground">
            {total ? totalText(total) : ''}
          </p>
          {sortMenu}
          {showColumns && <DataTableColumnMenu list={label} table={table} />}
        </div>
      </div>
      {list.isFiltered && (
        <div className="flex flex-wrap items-center gap-2">
          {chips}
          <Button
            variant="ghost"
            size="sm"
            aria-label={controlName('Reset', label)}
            onClick={list.reset}
          >
            Reset
          </Button>
        </div>
      )}
    </div>
  )
}
