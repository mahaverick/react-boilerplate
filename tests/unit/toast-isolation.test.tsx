import { render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'
import { Toaster } from '@/components/ui/sonner'

// Order-dependent on purpose: the second test checks what the first left behind.
describe('toast isolation between tests', () => {
  it('raises a toast while a Toaster is mounted', async () => {
    render(<Toaster />)
    toast('Left over from the previous test')

    expect(await screen.findByText('Left over from the previous test')).toBeInTheDocument()
    expect(toast.getToasts()).toHaveLength(1)
  })

  it('starts the next test with no toast still active', () => {
    expect(toast.getToasts()).toEqual([])
  })
})
