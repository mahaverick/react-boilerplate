import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PII_CLASS_NAME } from '@/observability/telemetry'

/** The elements `<Pii>` can render as. */
type PiiElement = 'span' | 'div' | 'p' | 'pre' | 'dd' | 'li'

/**
 * Marks a person's name, email address, initials or an invitation address so
 * analytics does not capture it: `PII_CLASS_NAME` adds `ph-sensitive`, which
 * keeps the text out of a clicked parent's `$el_text`, and `ph-mask`, which
 * masks it in session replay. Wrap only the PII itself, not the sentence
 * around it, so replay keeps the rest readable.
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
