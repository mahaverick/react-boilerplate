import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { UsageMeter } from '@/components/features/billing/usage-meter'

describe('UsageMeter', () => {
  it('says how much of the limit is used and exposes it as a meter', () => {
    render(<UsageMeter label="Members" usage={{ limit: 3, used: 3, approaching: false }} />)

    expect(screen.getByText('3 of 3 members')).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: 'Members' })
    expect(meter).toHaveAttribute('aria-valuenow', '3')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '3')
    expect(meter).toHaveAttribute('aria-valuetext', '3 of 3 members')
    expect(meter).toHaveAttribute('data-tone', 'full')
  })

  it('turns amber when the server says the limit is near', () => {
    render(<UsageMeter label="Members" usage={{ limit: 5, used: 4, approaching: true }} />)

    const meter = screen.getByRole('meter', { name: 'Members' })
    expect(meter).toHaveAttribute('data-tone', 'approaching')
    expect(meter.querySelector('.bg-warning-strong')).not.toBeNull()
  })

  it('keeps the normal tone below the soft limit', () => {
    render(<UsageMeter label="Members" usage={{ limit: 5, used: 2, approaching: false }} />)

    const meter = screen.getByRole('meter', { name: 'Members' })
    expect(meter).toHaveAttribute('data-tone', 'normal')
    expect(meter.querySelector('.bg-primary')).not.toBeNull()
  })

  it('caps the bar at full but reports the real count when over the limit', () => {
    render(<UsageMeter label="Members" usage={{ limit: 3, used: 5, approaching: false }} />)

    expect(screen.getByText('5 of 3 members')).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: 'Members' })
    // A meter's value never passes its maximum; the value text carries the real count.
    expect(meter).toHaveAttribute('aria-valuenow', '3')
    expect(meter).toHaveAttribute('aria-valuemax', '3')
    expect(meter).toHaveAttribute('aria-valuetext', '5 of 3 members')
    expect(meter).toHaveAttribute('data-tone', 'full')
    expect(meter.querySelector<HTMLElement>('[data-slot="meter-fill"]')?.style.width).toBe('100%')
  })

  it('shows the count and “No limit” without a bar when the plan has no limit', () => {
    render(<UsageMeter label="Members" usage={{ limit: null, used: 7, approaching: false }} />)

    expect(screen.getByText('7 members · No limit')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})
