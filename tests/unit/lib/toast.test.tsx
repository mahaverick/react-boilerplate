import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { Toaster } from '@/components/ui/toast'
import { toast } from '@/lib/toast'

/** The toast titles in the region, in DOM order (newest first). */
function titles(): (string | null)[] {
  const region = screen.queryByRole('region', { name: 'Status messages' })
  return [...(region?.querySelectorAll('[data-slot="toast-title"]') ?? [])].map(
    (title) => title.textContent
  )
}

describe('toast queue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues raises made while the replay is pending, so order holds and a newer id wins', async () => {
    toast.error('stale', { id: 'ro' })
    toast.success('A first')

    render(<Toaster />)
    act(() => {
      toast.error('fresh', { id: 'ro' })
      toast.success('B second')
    })

    const region = await screen.findByRole('region', { name: 'Status messages' })
    await within(region).findByRole('dialog', { name: 'B second' })
    expect(titles()).toEqual(['B second', 'fresh', 'A first'])
  })

  it('cancels the replay on unmount, so a quick remount waits its own delay and replays once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    toast.warning('Queued before any toaster.')

    const first = render(<Toaster />)
    await act(() => vi.advanceTimersByTimeAsync(60))
    first.unmount()
    render(<Toaster />)

    // 120 ms after the first mount, 60 ms after the second: only a stale timer could have replayed by now.
    await act(() => vi.advanceTimersByTimeAsync(60))
    expect(titles()).toEqual([])

    await act(() => vi.advanceTimersByTimeAsync(60))
    expect(titles()).toEqual(['Queued before any toaster.'])

    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(titles()).toEqual(['Queued before any toaster.'])
  })
})
