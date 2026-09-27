import { afterEach, describe, expect, it, vi } from 'vitest'
import { settle } from '@/tests/fixtures/timing'

describe('settle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['', '   ', '\n\t'])('refuses a blank reason (%j)', async (reason) => {
    await expect(settle(0, reason)).rejects.toThrow('settle() needs a reason')
  })

  it('refuses an empty literal reason in its type, too', async () => {
    // @ts-expect-error an empty reason is refused by the type
    await expect(settle(0, '')).rejects.toThrow('settle() needs a reason')
  })

  it('resolves once the given time has passed, and not before', async () => {
    vi.useFakeTimers()
    let done = false
    const waiting = settle(100, 'the behaviour under test').then(() => {
      done = true
    })

    await vi.advanceTimersByTimeAsync(99)
    expect(done).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(done).toBe(true)
  })
})
