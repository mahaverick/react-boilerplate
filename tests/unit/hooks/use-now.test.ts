import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW_TICK_MS, useNow } from '@/hooks/use-now'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-25T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at the current time', () => {
    const { result } = renderHook(() => useNow())
    expect(result.current).toBe(Date.parse('2026-09-25T12:00:00.000Z'))
  })

  // A relative time read once at render froze at "48 seconds ago" while the page stayed open.
  it('moves on every tick, so relative times stay current', () => {
    const { result } = renderHook(() => useNow())

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS)
    })

    expect(result.current).toBe(Date.parse('2026-09-25T12:00:00.000Z') + NOW_TICK_MS)
  })

  it('stops ticking once nothing reads it', () => {
    const { unmount } = renderHook(() => useNow())
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
