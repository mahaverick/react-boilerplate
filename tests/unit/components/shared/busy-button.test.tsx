import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { BusyButton } from '@/components/shared/busy-button'

describe('BusyButton', () => {
  it('shows its label when idle', () => {
    render(
      <BusyButton busy={false} busyLabel="Saving…">
        Save
      </BusyButton>
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('is disabled and busy, and is named by the busy label alone', () => {
    render(
      <BusyButton busy busyLabel="Saving…">
        Save
      </BusyButton>
    )
    const button = screen.getByRole('button', { name: 'Saving…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
