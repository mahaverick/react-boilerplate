import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toaster } from '@/components/ui/toast'
import { toast } from '@/lib/toast'

// Order-dependent on purpose: the second test checks what the first left behind.
describe('toast isolation between tests', () => {
  it('raises a toast while no Toaster is mounted, so it waits in the queue', () => {
    toast.error('Left over from the previous test', { description: 'queued' })
    toast.success('Also left over')
  })

  it('starts the next test with nothing queued', async () => {
    render(<Toaster />)
    act(() => toast.success('This test’s own toast'))

    // The queue replays on the Toaster's subscribe, before this test's toast; once this one shows, a replayed one would too.
    const region = screen.getByRole('region', { name: 'Status messages' })
    await within(region).findByRole('dialog', { name: 'This test’s own toast' })
    expect(within(region).getAllByRole('dialog')).toHaveLength(1)
  })
})
