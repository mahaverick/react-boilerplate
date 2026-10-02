import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pii } from '@/components/shared/pii'

describe('<Pii>', () => {
  it('renders a span carrying both analytics classes', () => {
    render(<Pii>Pii Probe</Pii>)
    const element = screen.getByText('Pii Probe')
    expect(element.tagName).toBe('SPAN')
    expect(element).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('renders as another element and keeps its own classes', () => {
    render(
      <dl>
        <Pii as="dd" className="font-medium">
          pii-probe@example.test
        </Pii>
      </dl>
    )
    const element = screen.getByText('pii-probe@example.test')
    expect(element.tagName).toBe('DD')
    expect(element).toHaveClass('ph-sensitive', 'ph-mask', 'font-medium')
  })
})
