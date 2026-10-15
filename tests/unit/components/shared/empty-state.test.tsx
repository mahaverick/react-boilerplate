import { IconUsers } from '@tabler/icons-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '@/components/shared/empty-state'

describe('EmptyState', () => {
  it('shows the icon, title, description and action at full size', () => {
    render(
      <EmptyState
        icon={<IconUsers data-testid="icon" />}
        title="No members"
        description="Invite someone to get started."
        action={<button type="button">Invite someone</button>}
      />
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('No members')).toBeInTheDocument()
    expect(screen.getByText('Invite someone to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite someone' })).toBeInTheDocument()
  })

  it('drops the icon when compact', () => {
    render(<EmptyState size="compact" icon={<IconUsers data-testid="icon" />} title="None." />)
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
    expect(screen.getByText('None.')).toBeInTheDocument()
  })

  it('marks its size for styling', () => {
    const { container } = render(<EmptyState size="compact" title="None." />)
    expect(container.querySelector('[data-slot="empty"]')).toHaveAttribute('data-size', 'compact')
  })
})
