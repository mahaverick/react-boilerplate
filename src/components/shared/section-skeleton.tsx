/**
 * @file The section templates: skeletons each section sizes to its own
 * content, so nothing moves when the content lands. They carry no text and no
 * live region; the section's `QueryState` marks itself `aria-busy`.
 */
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** A table's expected shape: its row and column counts. */
interface TableRowsSkeletonProps {
  rows: number
  columns: number
  className?: string
}

/** A bordered table: a 2.5rem header row, then `rows` rows of 3rem, each with a bar per column. */
export function TableRowsSkeleton({ rows, columns, className }: TableRowsSkeletonProps) {
  /** One row's bars, `height` tall (a Tailwind height class). */
  const cells = (height: string) =>
    Array.from({ length: columns }, (_, column) => (
      <Skeleton key={column} className={cn(height, 'flex-1')} />
    ))
  return (
    <div
      data-slot="table-rows-skeleton"
      className={cn('overflow-hidden rounded-xl border', className)}
    >
      <div className="flex h-10 items-center gap-4 px-4">{cells('h-3')}</div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-12 items-center gap-4 border-t px-4">
          {cells('h-4')}
        </div>
      ))}
    </div>
  )
}

/**
 * One KPI card: label, value and note bars on the real card, at least
 * `height` tall (a CSS length) so the grid keeps the loaded cards' height.
 * The default is the loaded KPI card's measured height (188 px); a page whose
 * cards are shorter passes its own.
 */
export function KpiCardSkeleton({ height = '11.75rem' }: { height?: string }) {
  return (
    <Card style={{ minHeight: height }}>
      <CardHeader className="gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-16" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-full" />
      </CardContent>
    </Card>
  )
}

/** `rows` full-width bars `rowHeight` tall (a CSS length, 2.5rem by default), for the rows inside a card. */
export function CardRowsSkeleton({
  rows,
  rowHeight = '2.5rem',
}: {
  rows: number
  rowHeight?: string
}) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className="w-full rounded-lg" style={{ height: rowHeight }} />
      ))}
    </div>
  )
}

/** `fields` label-and-input pairs at the form's spacing, then a button bar unless `action` is false. */
export function FormFieldsSkeleton({
  fields,
  action = true,
}: {
  fields: number
  action?: boolean
}) {
  return (
    <div className="grid gap-4">
      {Array.from({ length: fields }, (_, field) => (
        <div key={field} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      {action && <Skeleton className="h-9 w-28" />}
    </div>
  )
}
