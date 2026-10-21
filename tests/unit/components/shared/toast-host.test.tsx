import { render, screen, within } from '@testing-library/react'
import { Component, Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { ToastHost } from '@/components/shared/toast-host'
import { toast } from '@/lib/toast'

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

/** The toast region, once the lazy chunk has mounted it. */
function findRegion(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Status messages' })
}

describe('ToastHost', () => {
  afterEach(() => {
    vi.doUnmock('@/components/ui/toast')
    vi.doUnmock('@/observability/errors')
    vi.resetModules()
  })

  it('shows a toast raised before its lazy chunk mounted, once, with its type', async () => {
    toast.warning('Raised before the toast UI loaded.', { id: 'early' })
    toast.warning('Raised before the toast UI loaded.', { id: 'early' })
    toast.error('A second early toast.')

    render(<ToastHost />)
    // Suspense shows nothing until the chunk resolves, so no region exists yet.
    expect(screen.queryByRole('region', { name: 'Status messages' })).toBeNull()

    const region = await findRegion()
    const early = await within(region).findByRole('dialog', {
      name: 'Raised before the toast UI loaded.',
    })
    expect(early).toHaveAttribute('data-type', 'warning')
    expect(within(region).getByRole('dialog', { name: 'A second early toast.' })).toBeVisible()
    expect(within(region).getAllByRole('dialog')).toHaveLength(2)
  })

  // A live region announces what is added to it after it is in the document, not what it arrives with.
  it('inserts the empty region first, and the queued toast into it afterwards', async () => {
    toast.error('Raised before the region existed.')
    const dialogsInRegion: number[] = []
    const observer = new MutationObserver(() => {
      const region = document.querySelector('[role="region"][aria-label="Status messages"]')
      if (region) dialogsInRegion.push(region.querySelectorAll('[role="dialog"]').length)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    render(<ToastHost />)
    const region = await findRegion()
    await within(region).findByRole('dialog', { name: 'Raised before the region existed.' })
    observer.disconnect()

    expect(dialogsInRegion[0]).toBe(0)
    expect(dialogsInRegion.at(-1)).toBe(1)
  })

  it('keeps only the newest 10 toasts raised before it mounted', async () => {
    for (let n = 1; n <= 12; n += 1) toast.success(`Early toast ${n}`)

    render(<ToastHost />)
    const region = await findRegion()
    await within(region).findByRole('dialog', { name: 'Early toast 12' })

    const titles = [...region.querySelectorAll('[data-slot="toast-title"]')].map(
      (title) => title.textContent
    )
    expect(titles).toHaveLength(10)
    expect(titles).not.toContain('Early toast 1')
    expect(titles).not.toContain('Early toast 2')
    expect(titles).toContain('Early toast 3')
  })

  it('reports a failed toast chunk, renders nothing, and keeps the page', async () => {
    vi.resetModules()
    const noteError = vi.fn()
    vi.doMock('@/observability/errors', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/observability/errors')>()),
      noteError,
    }))
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
    await vi.waitFor(() => expect(noteError).toHaveBeenCalledTimes(1))
    // The commit after the report is the lazy component settling on the empty fallback.
    await vi.waitFor(() => expect(commits.mock.calls.map(([, phase]) => phase)).toContain('update'))

    expect(noteError).toHaveBeenCalledWith(expect.any(Error), 'chunk_load', false)
    expect(screen.getByText('the page')).toBeInTheDocument()
    expect(screen.queryByText('boundary caught')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Status messages' })).toBeNull()
  })
})
