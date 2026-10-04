import { afterEach, describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => vi.fn())

vi.mock('@/observability/errors/report', () => {
  loaded()
  return { report: vi.fn() }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the idle load of the reporter without requestIdleCallback', () => {
  it('falls back to a timer', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { IDLE_LOAD_FALLBACK_MS, installErrorListeners } =
      await import('@/observability/errors/listen')
    installErrorListeners()
    await vi.advanceTimersByTimeAsync(IDLE_LOAD_FALLBACK_MS - 1)
    expect(loaded).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await vi.waitFor(() => {
      expect(loaded).toHaveBeenCalledTimes(1)
    })
  })
})
