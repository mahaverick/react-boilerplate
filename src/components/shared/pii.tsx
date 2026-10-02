import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PII_CLASS_NAME } from '@/observability/analytics'

/** The elements `<Pii>` can render as. */
type PiiElement = 'span' | 'div' | 'p' | 'pre' | 'dd' | 'li'

/**
 * Marks a person's name, email address, initials or an invitation address so
 * analytics never captures it: `ph-sensitive` keeps it out of a clicked
 * parent's `$el_text`, `ph-mask` masks it in session replay. Wrap only the PII
 * itself, not the sentence around it, so replay keeps the rest readable.
 */
export function Pii({
  as: Element = 'span',
  className,
  children,
}: {
  as?: PiiElement
  className?: string
  children: ReactNode
}) {
  return <Element className={cn(PII_CLASS_NAME, className)}>{children}</Element>
}
