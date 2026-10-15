import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'

/** How much a note asks of the reader: act on it, notice it, or nothing. */
export type NoteTone = 'warning' | 'info' | 'passive'

/** A note's tone, optional title and text. */
interface NoteProps {
  tone: NoteTone
  title?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * A note that is part of the page, not a failure. Warning and info are tinted
 * alerts that announce politely (`role="status"`), since they are there on
 * load; passive is a muted row with no live region, for "not set up" and
 * "nothing yet".
 */
export function Note({ tone, title, children, className }: NoteProps) {
  if (tone === 'passive') {
    return (
      <Item variant="muted" size="sm" className={className}>
        <ItemContent>
          {title && <ItemTitle className="line-clamp-none">{title}</ItemTitle>}
          <ItemDescription className="line-clamp-none">{children}</ItemDescription>
        </ItemContent>
      </Item>
    )
  }
  const Icon = tone === 'warning' ? IconAlertTriangle : IconInfoCircle
  return (
    <Alert variant={tone} role="status" data-variant={tone} className={className}>
      <Icon aria-hidden="true" />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
