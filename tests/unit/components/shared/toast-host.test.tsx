import { act, render, screen, within } from '@testing-library/react'
import { Component, Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastHost } from '@/components/shared/toast-host'
import { toast } from '@/lib/toast'
import { settle } from '@/tests/fixtures/timing'

/** Shows "boundary caught" if anything below it throws while rendering. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  /** Records the failure so the next render shows the marker. */
  static getDerivedStateFromError() {
    return { failed: true }
  }

  /** Renders the marker after a failure, else the children. */
  render() {
    return this.state.failed ? <p>boundary caught</p> : this.props.children
  }
}

describe('ToastHost', () => {
  afterEach(() => {
    vi.doUnmock('@/components/ui/toast')
    vi.resetModules()
  })

  it('shows a toast raised before its lazy chunk mounted, once, with its type', async () => {
    toast.warning('Raised before the toast UI loaded.', { id: 'early' })
    toast.warning('Raised before the toast UI loaded.', { id: 'early' })
    toast.error('A second early toast.')

    render(<ToastHost />)
    // Suspense shows nothing until the chunk resolves, so no region exists yet.
    expect(screen.queryByRole('region', { name: 'Status messages' })).toBeNull()

    const region = await screen.findByRole('region', { name: 'Status messages' })
    const early = await within(region).findByRole('dialog', {
      name: 'Raised before the toast UI loaded.',
    })
    expect(early).toHaveAttribute('data-type', 'warning')
    expect(within(region).getByRole('dialog', { name: 'A second early toast.' })).toBeVisible()
    expect(within(region).getAllByRole('dialog')).toHaveLength(2)
  })

  it('renders nothing, and keeps the page, when the toast chunk fails to load', async () => {
    vi.resetModules()
    vi.doMock('@/components/ui/toast', () => {
      throw new Error('chunk gone')
    })
    const { ToastHost: FreshHost } = await import('@/components/shared/toast-host')
    const commits = vi.fn<ProfilerOnRenderCallback>()

    render(
      <Boundary>
        <p>the page</p>
        <Profiler id="host" onRender={commits}>
          <FreshHost />
        </Profiler>
      </Boundary>
    )
    await vi.waitFor(() => expect(commits.mock.calls.map(([, phase]) => phase)).toContain('update'))
    // React throttles suspense reveals, so a rejected lazy can reach the boundary well after this commit; success renders nothing to wait on.
    await act(() =>
      settle(600, 'a rejected lazy surfaces after the suspense throttle; success is silent')
    )

    expect(screen.getByText('the page')).toBeInTheDocument()
    expect(screen.queryByText('boundary caught')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Status messages' })).toBeNull()
  })
})
