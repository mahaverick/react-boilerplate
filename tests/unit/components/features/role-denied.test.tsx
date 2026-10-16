import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RoleDenied } from '@/components/features/role-denied'

describe('RoleDenied', () => {
  it('announces the refusal and offers a reload', () => {
    render(<RoleDenied />)
    expect(screen.getByRole('alert')).toHaveTextContent('Your role can’t see this any more.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })
})
