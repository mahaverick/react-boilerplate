import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageSkeleton, type PageVariant } from '@/components/shared/page-skeleton'

const VARIANTS: PageVariant[] = ['list', 'detail', 'dashboard', 'settings']

describe('PageSkeleton', () => {
  it.each(VARIANTS)('the %s template announces loading, with no spinner', (variant) => {
    const { container } = render(<PageSkeleton variant={variant} />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull()
    expect(container.querySelector('[data-slot="page-heading-skeleton"]')).not.toBeNull()
  })

  it('draws the list template as a heading, a toolbar of three controls and eight table rows', () => {
    const { container } = render(<PageSkeleton variant="list" />)
    expect(container.querySelectorAll('[data-slot="page-toolbar-skeleton"] > *')).toHaveLength(3)
    expect(container.querySelectorAll('[data-slot="table-rows-skeleton"] > div')).toHaveLength(9)
  })

  it('draws the detail template with a tab bar and two cards', () => {
    const { container } = render(<PageSkeleton variant="detail" />)
    expect(container.querySelector('[data-slot="page-tabs-skeleton"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(2)
  })

  it('draws the dashboard template with four KPI cards at the loaded height and two chart blocks', () => {
    const { container } = render(<PageSkeleton variant="dashboard" />)
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(4)
    expect(container.querySelector('[data-slot="card"]')).toHaveProperty(
      'style.minHeight',
      '11.75rem'
    )
    expect(container.querySelectorAll('[data-slot="page-chart-skeleton"]')).toHaveLength(2)
  })

  it('draws the settings template with three cards of form rows', () => {
    const { container } = render(<PageSkeleton variant="settings" />)
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
  })

  it('draws the auth card', () => {
    const { container } = render(<PageSkeleton variant="auth" />)
    const region = screen.getByRole('status', { name: 'Loading' })
    expect(region).toHaveAttribute('data-variant', 'auth')
    expect(container.querySelector('[data-slot="page-heading-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1)
    // Two fields (label over input) and one full-width button bar.
    expect(container.querySelectorAll('[data-slot="card"] .grid.gap-2')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="card"] .h-9')).toHaveLength(3)
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull()
  })

  it('leaves the heading and tab bar to the layout when nested', () => {
    const { container } = render(<PageSkeleton variant="detail" nested />)
    expect(container.querySelector('[data-slot="page-heading-skeleton"]')).toBeNull()
    expect(container.querySelector('[data-slot="page-tabs-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(2)
  })
})
