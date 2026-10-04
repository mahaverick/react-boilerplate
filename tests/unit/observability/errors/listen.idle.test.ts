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

describe('the idle load of the reporter', () => {
  it('waits for the browser to be idle, at most the fallback', async () => {
    const idle = vi.fn()
    vi.stubGlobal('requestIdleCallback', idle)
    const { IDLE_LOAD_FALLBACK_MS, installErrorListeners } =
      await import('@/observability/errors/listen')
    installErrorListeners()
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_LOAD_FALLBACK_MS })
    expect(loaded).not.toHaveBeenCalled()
    const [load] = idle.mock.calls[0] as [() => void]
    load()
    await vi.waitFor(() => {
      expect(loaded).toHaveBeenCalledTimes(1)
    })
  })
})
