import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useId } from 'react'
import { showingText } from '@/components/shared/data-table/data-table-model'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PAGE_SIZES, type ListPageInfo, type PageSize } from '@/types/list.types'

/**
 * The list's paging: where this page sits, the page size, and Previous and
 * Next inside a navigation landmark named for the list. The buttons follow the page's
 * `hasPrev` and `hasNext`, and are off while the next view loads.
 */
export function DataTablePagination({
  label,
  page,
  pageIndex,
  limit,
  rowCount,
  busy,
  onPrev,
  onNext,
  onLimit,
}: {
  /** The list's name; the landmark is "{label} pagination", unique when a page holds two lists. */
  label: string
  page: ListPageInfo
  pageIndex: number | undefined
  limit: PageSize
  rowCount: number
  busy: boolean
  onPrev: () => void
  onNext: () => void
  onLimit: (limit: PageSize) => void
}) {
  const labelId = useId()
  const showing = showingText(pageIndex, limit, rowCount)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{showing}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span id={labelId} className="text-sm">
            Rows per page
          </span>
          <Select
            value={String(limit)}
            onValueChange={(value: string | null) => {
              const size = PAGE_SIZES.find((option) => String(option) === value)
              if (size !== undefined) onLimit(size)
            }}
          >
            <SelectTrigger aria-labelledby={labelId} className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav aria-label={`${label} pagination`} className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={!page.hasPrev || busy}
            onClick={onPrev}
          >
            <IconChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={!page.hasNext || busy}
            onClick={onNext}
          >
            <IconChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </div>
    </div>
  )
}
