import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { COUNTDOWN_TICK_MS, useCountdown } from '@/hooks/use-countdown'

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.parse('2026-10-19T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down each second and stops at zero', async () => {
    const until = Date.now() + 3_000
    const { result } = renderHook(() => useCountdown(until))
    expect(result.current).toBe(3)

    for (const expected of [2, 1, 0]) {
      await act(() => vi.advanceTimersByTimeAsync(COUNTDOWN_TICK_MS))
      expect(result.current).toBe(expected)
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rounds a part second up', () => {
    const { result } = renderHook(() => useCountdown(Date.now() + 2_001))
    expect(result.current).toBe(3)
  })

  it('answers 0 for null and for the past', () => {
    expect(renderHook(() => useCountdown(null)).result.current).toBe(0)
    expect(renderHook(() => useCountdown(Date.now() - 5_000)).result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('answers 0 for a time that is not a number', () => {
    expect(renderHook(() => useCountdown(Number.NaN)).result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts when until moves later', async () => {
    const first = Date.now() + 1_000
    const { result, rerender } = renderHook(({ until }) => useCountdown(until), {
      initialProps: { until: first },
    })
    await act(() => vi.advanceTimersByTimeAsync(COUNTDOWN_TICK_MS))
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    rerender({ until: Date.now() + 5_000 })
    expect(result.current).toBe(5)
    await act(() => vi.advanceTimersByTimeAsync(COUNTDOWN_TICK_MS))
    expect(result.current).toBe(4)
  })
})
