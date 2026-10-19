import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('looks disabled, and keeps its pointer events, when disabled but focusable', () => {
    render(
      <Button disabled focusableWhenDisabled>
        Resend
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Resend' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('disabled')
    expect(button).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
    expect(button).not.toHaveClass('aria-disabled:pointer-events-none')
  })
})
