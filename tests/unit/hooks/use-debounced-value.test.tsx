import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the previous value until the delay has passed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('ab')
  })

  // Typing "acme" at speed must produce ONE value, not four.
  it('restarts the wait on every change, so a burst settles once', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: '' },
    })

    for (const value of ['a', 'ac', 'acm', 'acme']) {
      rerender({ value })
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(result.current).toBe('')
    }
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current).toBe('acme')
  })
})
