import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import {
  CardRowsSkeleton,
  FormFieldsSkeleton,
  KpiCardSkeleton,
  TableRowsSkeleton,
} from '@/components/shared/section-skeleton'

/** The skeleton bars inside `container`. */
function bars(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="skeleton"]')
}

describe('section templates', () => {
  it('draws a header row and one row per expected row, each with a bar per column', () => {
    const { container } = render(<TableRowsSkeleton rows={8} columns={4} />)
    const rows = container.querySelectorAll('[data-slot="table-rows-skeleton"] > div')
    expect(rows).toHaveLength(9)
    expect(bars(container)).toHaveLength(36)
  })

  it('draws a KPI card with its label, value and note, at the loaded card’s height by default', () => {
    const { container } = render(<KpiCardSkeleton />)
    const card = container.querySelector('[data-slot="card"]')
    expect(card).toHaveProperty('style.minHeight', '11.75rem')
    expect(bars(container)).toHaveLength(3)
  })

  it('draws a KPI card at the height a page gives it', () => {
    const { container } = render(<KpiCardSkeleton height="9rem" />)
    expect(container.querySelector('[data-slot="card"]')).toHaveProperty('style.minHeight', '9rem')
  })

  it('draws card rows at the given height', () => {
    const { container } = render(<CardRowsSkeleton rows={4} rowHeight="2.875rem" />)
    expect(bars(container)).toHaveLength(4)
    expect(bars(container)[0]).toHaveProperty('style.height', '2.875rem')
  })

  it('draws a label and an input per field, then the action', () => {
    const { container } = render(<FormFieldsSkeleton fields={3} />)
    expect(bars(container)).toHaveLength(7)
  })

  it('leaves the action out when asked', () => {
    const { container } = render(<FormFieldsSkeleton fields={2} action={false} />)
    expect(bars(container)).toHaveLength(4)
  })

  it('has no text and no live region of its own', () => {
    const { container } = render(<TableRowsSkeleton rows={2} columns={2} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('[role]')).toBeNull()
  })
})
