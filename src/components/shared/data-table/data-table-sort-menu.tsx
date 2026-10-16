import { IconArrowsSort } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** One choice of the sort menu: a sort key and how it reads. */
export interface DataTableSortOption {
  key: string
  label: string
}

/**
 * The sort control for the card layout, where there are no column headers: a
 * menu named "Sort by" with one radio choice per sort key.
 */
export function DataTableSortMenu({
  options,
  value,
  onSort,
}: {
  options: readonly DataTableSortOption[]
  /** The list's effective sort key. */
  value: string
  onSort: (key: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="justify-self-start" aria-label="Sort by" />
        }
      >
        <IconArrowsSort aria-hidden="true" />
        Sort
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={(key: string) => onSort(key)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
