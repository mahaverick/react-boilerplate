import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { LoadError } from '@/components/features/load-error'

describe('LoadError', () => {
  it('announces the failure and retries once per click', async () => {
    const onRetry = vi.fn()
    render(
      <LoadError
        message="We couldn’t load the list. Select Try again to load it."
        onRetry={onRetry}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Not loaded')
    expect(alert).toHaveTextContent('We couldn’t load the list. Select Try again to load it.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('reserves room for the retry button beside the message', () => {
    render(<LoadError message="Failed." onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveClass('has-data-[slot=alert-action]:pr-28')
  })
})
