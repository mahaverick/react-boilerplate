import type { ReactNode } from 'react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

/** How much room an empty state takes: a whole list or tab, or a slot inside a card. */
export type EmptyStateSize = 'full' | 'compact'

/** What an empty state says, and the one action it may offer. */
interface EmptyStateProps {
  size?: EmptyStateSize
  /** Shown at full size only. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Only an action the page already offers elsewhere. */
  action?: ReactNode
  className?: string
}

/**
 * Every "nothing here" in the app. Full size is for a page's main list or a
 * whole tab: icon, title, description, action. Compact is for a slot inside a
 * card: title and description only, with tighter padding.
 */
export function EmptyState({
  size = 'full',
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const compact = size === 'compact'
  return (
    <Empty data-size={size} className={cn(compact ? 'gap-2 p-4' : 'border', className)}>
      <EmptyHeader className={compact ? 'gap-1' : undefined}>
        {!compact && icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle className={compact ? 'text-sm font-medium' : undefined}>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
