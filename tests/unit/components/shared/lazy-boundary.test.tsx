import { render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LazyBoundary } from '@/components/shared/lazy-boundary'

/** A child that throws while rendering. */
function Explodes(): never {
  throw new Error('chunk exploded')
}

describe('LazyBoundary', () => {
  it('renders its children while they work', () => {
    render(
      <LazyBoundary fallback={<p>fallback</p>}>
        <p>child</p>
      </LazyBoundary>
    )
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).not.toBeInTheDocument()
  })

  it('shows the fallback, and leaves its siblings alone, when a lazy chunk fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module'))
    )
    render(
      <>
        <LazyBoundary fallback={<p>fallback</p>}>
          <Suspense fallback={null}>
            <Broken />
          </Suspense>
        </LazyBoundary>
        <p>sibling</p>
      </>
    )
    expect(await screen.findByText('fallback')).toBeInTheDocument()
    expect(screen.getByText('sibling')).toBeInTheDocument()
  })

  it('renders nothing for a null fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <LazyBoundary fallback={null}>
        <Explodes />
      </LazyBoundary>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
