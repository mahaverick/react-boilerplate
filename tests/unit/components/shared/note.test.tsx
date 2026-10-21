import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { Note } from '@/components/shared/note'

describe('Note', () => {
  it.each(['warning', 'info'] as const)('renders a %s note as a status, never an alert', (tone) => {
    render(
      <Note tone={tone} title="Heads up">
        This address is suppressed.
      </Note>
    )
    expect(screen.getByRole('status')).toHaveTextContent('This address is suppressed.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-variant', tone)
  })

  it('renders a passive note with no live region', () => {
    render(<Note tone="passive">Not set up yet.</Note>)
    expect(screen.getByText('Not set up yet.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('never truncates a long passive note', () => {
    render(
      <Note tone="passive" title="Not set up">
        A long explanation that must stay readable in full.
      </Note>
    )
    expect(screen.getByText('A long explanation that must stay readable in full.')).toHaveClass(
      'line-clamp-none'
    )
    expect(screen.getByText('Not set up')).toHaveClass('line-clamp-none')
  })
})
