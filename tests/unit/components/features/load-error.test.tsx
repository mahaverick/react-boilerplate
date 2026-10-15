import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LoadError } from '@/components/features/load-error'

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
})
