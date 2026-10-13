import { render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { PII_CLASS_NAME } from '@/observability/telemetry'

/** The masked ancestor of a raised toast, or null when nothing above it carries the class. */
function maskedAncestor(text: string): Element | null {
  return screen.getByText(text).closest(`.${PII_CLASS_NAME.split(' ').join('.')}`)
}

describe('Toaster', () => {
  it('masks every toast for analytics', async () => {
    render(<Toaster />)
    toast('Invited ada@example.com')

    await screen.findByText('Invited ada@example.com')
    expect(maskedAncestor('Invited ada@example.com')).not.toBeNull()
  })

  // A caller's className used to replace the masking classes, unmasking every toast.
  it('keeps the mask when a caller passes its own className', async () => {
    render(<Toaster className="extra" />)
    toast('Removed grace@example.com')

    await screen.findByText('Removed grace@example.com')
    const host = maskedAncestor('Removed grace@example.com')
    expect(host).not.toBeNull()
    expect(host).toHaveClass('extra')
  })
})
