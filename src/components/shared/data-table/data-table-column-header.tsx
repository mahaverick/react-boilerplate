import { IconArrowDown, IconArrowsSort, IconArrowUp } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

/**
 * A sortable column's header content: a button named by the column, with an
 * arrow for the direction it is sorted in (hidden from assistive tech: the
 * `th`'s `aria-sort` carries the state, per the WAI-ARIA sortable table).
 */
export function DataTableColumnHeader({
  label,
  sorted,
  onSort,
}: {
  label: string
  sorted: false | 'asc' | 'desc'
  onSort: () => void
}) {
  const Icon = sorted === 'asc' ? IconArrowUp : sorted === 'desc' ? IconArrowDown : IconArrowsSort
  return (
    <Button variant="ghost" size="sm" className="-ml-2 h-8" onClick={onSort}>
      {label}
      <Icon aria-hidden="true" className={sorted === false ? 'opacity-50' : undefined} />
    </Button>
  )
}
