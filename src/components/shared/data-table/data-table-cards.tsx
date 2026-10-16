import type { ReactTable, RowData } from '@tanstack/react-table'
import { Fragment, type ReactNode, type RefCallback } from 'react'
import {
  columnLabel,
  type DataTableFeatures,
} from '@/components/shared/data-table/data-table-model'
import { Item, ItemContent, ItemFooter, ItemGroup } from '@/components/ui/item'

/** What a list's own card is given besides its row. */
export interface DataTableCardHelpers {
  /** The row's focus-landmark ref (`rowTarget(row.id)`), to put on the card element with `tabIndex={-1}`; undefined without `rowTarget`. */
  target: RefCallback<HTMLElement> | undefined
}

/**
 * The phone layout: one card per row, built from the visible columns. The
 * first column is the card's title, each other column a label and value, and
 * the action columns sit at the bottom. A list's own `card` replaces the
 * whole card and must render one `role="listitem"` element; it receives
 * `{ target }` to register that element as the row's focus landmark.
 */
export function DataTableCards<T extends RowData>({
  table,
  label,
  card,
  rowTarget,
}: {
  table: ReactTable<DataTableFeatures, T>
  label: string
  card?: (row: T, helpers: DataTableCardHelpers) => ReactNode
  /** Registers each built card as a focus landmark, as `DataTable` does each row. */
  rowTarget?: (id: string) => RefCallback<HTMLElement>
}) {
  return (
    <ItemGroup aria-label={label} className="gap-3">
      {table.getRowModel().rows.map((row) => {
        if (card)
          return (
            <Fragment key={row.id}>{card(row.original, { target: rowTarget?.(row.id) })}</Fragment>
          )
        const [title, ...rest] = row.getVisibleCells()
        const actions = rest.filter((cell) => cell.column.columnDef.meta?.actions)
        const fields = rest.filter((cell) => !cell.column.columnDef.meta?.actions)
        return (
          <Item
            key={row.id}
            ref={rowTarget?.(row.id)}
            tabIndex={rowTarget === undefined ? undefined : -1}
            variant="outline"
            role="listitem"
            className={rowTarget === undefined ? undefined : 'outline-none'}
          >
            <ItemContent className="min-w-0">
              {title && (
                <div className="text-sm leading-snug font-medium wrap-break-word">
                  <table.FlexRender cell={title} />
                </div>
              )}
              {fields.length > 0 && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  {fields.map((cell) => (
                    <Fragment key={cell.id}>
                      <dt className="text-muted-foreground">{columnLabel(cell.column)}</dt>
                      <dd className="min-w-0 wrap-break-word">
                        <table.FlexRender cell={cell} />
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </ItemContent>
            {actions.length > 0 && (
              <ItemFooter className="flex-wrap justify-start">
                {actions.map((cell) => (
                  <table.FlexRender key={cell.id} cell={cell} />
                ))}
              </ItemFooter>
            )}
          </Item>
        )
      })}
    </ItemGroup>
  )
}
