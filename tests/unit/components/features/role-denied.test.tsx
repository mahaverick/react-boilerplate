import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { RoleDenied } from '@/components/features/role-denied'

describe('RoleDenied', () => {
  it('announces the refusal and offers a reload', () => {
    render(<RoleDenied />)
    expect(screen.getByRole('alert')).toHaveTextContent('Your role can’t see this any more.')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reload the page to see what your current role allows.'
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })
})
