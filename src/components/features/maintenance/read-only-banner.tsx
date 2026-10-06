import { ChevronDown, ChevronUp, Wrench } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DEFAULT_MAINTENANCE_MESSAGE } from './maintenance-page'

/**
 * Shown on every page while maintenance is `read_only`. Not dismissible: it
 * stays true for as long as writes are refused. It collapses to its one-line
 * summary, and the owner's message, rendered as text, is the part that hides.
 *
 * `bg-muted` with `text-foreground`, the pair `PlatformAccessBanner` measured
 * at AA.
 */
export function ReadOnlyBanner({ message }: { message: string | null }) {
  const [isCollapsed, setCollapsed] = useState(false)
  const detailsId = useId()

  return (
    <section
      aria-label="Maintenance"
      className="border-b bg-muted px-4 py-2 text-sm text-foreground"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Wrench aria-hidden="true" className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 font-medium">
          Maintenance is in progress: you can look around, but changes are paused.
        </p>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!isCollapsed}
          aria-controls={detailsId}
          onClick={() => setCollapsed((collapsed) => !collapsed)}
        >
          {isCollapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          {isCollapsed ? 'Show details' : 'Hide details'}
        </Button>
      </div>
      <p id={detailsId} hidden={isCollapsed} className="mt-1 pl-7 whitespace-pre-line">
        {message ?? DEFAULT_MAINTENANCE_MESSAGE}
      </p>
    </section>
  )
}
