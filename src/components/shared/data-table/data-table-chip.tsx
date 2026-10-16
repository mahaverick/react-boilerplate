import { IconX } from '@tabler/icons-react'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'

/**
 * One applied filter value, shown by name with a control that removes it.
 * The `prefix` is fixed text ("Status: "); the `value` masks only when
 * `isPersonal` says it names a person.
 */
export function DataTableChip({
  prefix,
  value,
  isPersonal = false,
  onRemove,
}: {
  prefix: string
  value: string
  isPersonal?: boolean
  onRemove: () => void
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-4xl border py-0.5 pr-0.5 pl-2.5 text-xs">
      <span className="truncate">
        {prefix}
        {isPersonal ? <Pii>{value}</Pii> : value}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove filter: ${prefix}${value}`}
        onClick={onRemove}
      >
        <IconX aria-hidden="true" />
      </Button>
    </span>
  )
}
