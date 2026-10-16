import { IconCirclePlus } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import {
  controlName,
  toggleValue,
  type DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MAX_SEARCH_LENGTH } from '@/types/list.types'

/**
 * One filter's button and popover: a checkbox per option (several may be
 * picked unless `single`), a search box when the server holds the options,
 * the options' own loading and failure, and Clear filter. The button says
 * how many values are picked.
 */
export function DataTableFacetedFilter({
  list,
  filter,
  selected,
  onChange,
}: {
  /** The list's label, so a page with two lists can tell their filters apart. */
  list: string
  filter: DataTableFilter
  selected: readonly string[]
  onChange: (values: string[]) => void
}) {
  const [term, setTerm] = useState('')
  const options = useRef<HTMLDivElement>(null)
  const count = selected.length
  const state = filter.optionsState
  // "Filter by status, Members": it differs from a sortable header's button of the same word, and from the other list's filter.
  const name = controlName(`Filter by ${filter.label.toLowerCase()}`, list)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="border-dashed"
            aria-label={count > 0 ? `${name}, ${count} selected` : name}
          />
        }
      >
        <IconCirclePlus aria-hidden="true" />
        {filter.label}
        {count > 0 && (
          <Badge variant="secondary" aria-hidden="true" className="rounded-sm px-1 font-normal">
            {count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-2" aria-label={name}>
        {filter.onSearch && (
          <Input
            type="search"
            aria-label={`Search ${filter.label.toLowerCase()}`}
            placeholder="Search"
            maxLength={MAX_SEARCH_LENGTH}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              filter.onSearch?.(event.target.value)
            }}
          />
        )}
        {state?.isError ? (
          <div className="grid justify-items-start gap-2 p-1">
            <p className="text-sm">{filter.label} could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={state.retry}>
              Try again
            </Button>
          </div>
        ) : state?.isPending ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : filter.options.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">No matches.</p>
        ) : (
          <div
            ref={options}
            role="group"
            aria-label={filter.label}
            className="grid max-h-72 gap-0.5 overflow-y-auto"
          >
            {filter.options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(option.value)}
                  onCheckedChange={(checked) =>
                    onChange(toggleValue(selected, option.value, checked, filter.single))
                  }
                />
                {filter.isPersonal ? <Pii>{option.label}</Pii> : option.label}
              </label>
            ))}
          </div>
        )}
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange([])
              // The button leaves with the picks; focus stays inside the popover.
              options.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus()
            }}
          >
            Clear filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
