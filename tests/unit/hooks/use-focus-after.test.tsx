import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusAfter, type FocusAfter } from '@/hooks/use-focus-after'

/** Renders the targets and hands the hook's api to the test, which has no other way to reach it. */
function Harness({
  showA,
  showB,
  onFocus,
}: {
  showA: boolean
  showB: boolean
  onFocus: (focus: FocusAfter<'a' | 'b'>) => void
}) {
  const focus = useFocusAfter<'a' | 'b'>()
  useEffect(() => {
    onFocus(focus)
  }, [focus, onFocus])
  return (
    <div>
      {showA && <button ref={focus.target('a')}>A</button>}
      {showB && <button ref={focus.target('b')}>B</button>}
    </div>
  )
}

describe('useFocusAfter', () => {
  let focus: FocusAfter<'a' | 'b'>
  const take = (value: FocusAfter<'a' | 'b'>) => {
    focus = value
  }

  it('focuses a target that is already mounted', () => {
    render(<Harness showA showB onFocus={take} />)
    act(() => {
      focus.focusAfter('b')
    })
    expect(screen.getByRole('button', { name: 'B' })).toHaveFocus()
  })

  it('waits for a target that mounts later, and focuses it once', () => {
    const { rerender } = render(<Harness showA showB={false} onFocus={take} />)
    act(() => {
      focus.focusAfter('b')
    })
    expect(document.body).toHaveFocus()

    rerender(<Harness showA showB onFocus={take} />)
    const b = screen.getByRole('button', { name: 'B' })
    expect(b).toHaveFocus()

    b.blur()
    rerender(<Harness showA={false} showB onFocus={take} />)
    expect(document.body).toHaveFocus()
  })

  it('forgets a target that unmounted', () => {
    const { rerender } = render(<Harness showA showB onFocus={take} />)
    rerender(<Harness showA={false} showB onFocus={take} />)
    act(() => {
      focus.focusAfter('a')
    })
    expect(document.body).toHaveFocus()
  })
})
