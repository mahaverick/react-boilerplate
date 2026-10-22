import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vite-plus/test'
import { SectionBoundary } from '@/components/shared/section-boundary'
import { rootErrorOptions } from '@/observability/errors'
import { report } from '@/observability/errors/report'

vi.mock('@/observability/errors/report', () => ({ report: vi.fn() }))

/** A child that throws while rendering, for the boundary to contain. */
function Explodes(): never {
  throw new Error('chart exploded')
}

describe('SectionBoundary', () => {
  it('contains a render error to its own section', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <>
        <SectionBoundary name="Sign-ups">
          <Explodes />
        </SectionBoundary>
        <p>Sibling still here</p>
      </>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sign-ups didn’t load. Reload the page to try again.'
    )
    expect(screen.getByText('Sibling still here')).toBeInTheDocument()
  })

  it("is reported once, as handled, origin react, through the root's onCaughtError", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container, rootErrorOptions)
    act(() => {
      root.render(
        <SectionBoundary name="Sign-ups">
          <Explodes />
        </SectionBoundary>
      )
    })
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    const [error, origin, handled] = vi.mocked(report).mock.calls[0] ?? []
    expect((error as Error).message).toBe('chart exploded')
    expect(origin).toBe('react')
    expect(handled).toBe(true)
    expect(container.textContent).toContain('Sign-ups didn’t load. Reload the page to try again.')
    act(() => root.unmount())
    container.remove()
  })
})
