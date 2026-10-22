import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'

describe('LoadError', () => {
  it('announces the failure and retries once per click', async () => {
    const onRetry = vi.fn()
    render(<LoadError message="We could not load the tenants." onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load')
    expect(alert).toHaveTextContent('We could not load the tenants.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('words the failed role lookup with its effect and the next step', () => {
    expect(ROLE_ERROR).toBe(
      'We couldn’t load your role in this tenant, so its controls are hidden. Try again to show them.'
    )
  })

  it('reserves room for the retry button beside the message', () => {
    render(<LoadError message="Failed." onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveClass('has-data-[slot=alert-action]:pr-28')
  })
})
