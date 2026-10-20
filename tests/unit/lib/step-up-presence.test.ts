import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdStepUpWait, isStepUpWaitHeld, STEP_UP_WAIT_LOCK } from '@/lib/step-up-presence'
import { removeWebLocks, stubWebLocks } from '@/tests/mocks/web-locks'

afterEach(removeWebLocks)

describe('step-up presence', () => {
  it('holds and releases the shared lock', async () => {
    const locks = stubWebLocks()
    await expect(isStepUpWaitHeld()).resolves.toBe(false)

    const release = holdStepUpWait()
    await vi.waitFor(() => expect(locks.held).toHaveLength(1))
    expect(locks.requests).toEqual([{ name: STEP_UP_WAIT_LOCK, mode: 'shared' }])
    await expect(isStepUpWaitHeld()).resolves.toBe(true)

    release()
    await vi.waitFor(() => expect(locks.held).toEqual([]))
    await expect(isStepUpWaitHeld()).resolves.toBe(false)
  })

  it('ignores a lock held under another name', async () => {
    const locks = stubWebLocks()
    /** Lets go of the other lock; set once the stub runs its callback. */
    let releaseOther = () => {}
    void navigator.locks.request(
      'auth-refresh',
      () =>
        new Promise<void>((resolve) => {
          releaseOther = resolve
        })
    )
    await vi.waitFor(() => expect(locks.held).toHaveLength(1))

    await expect(isStepUpWaitHeld()).resolves.toBe(false)
    releaseOther()
  })

  it('lets release run twice, and before the lock is granted', async () => {
    const locks = stubWebLocks()
    const release = holdStepUpWait()
    release()
    release()
    await vi.waitFor(() => expect(locks.requests).toHaveLength(1))
    await vi.waitFor(() => expect(locks.held).toEqual([]))
  })

  it('answers null without Web Locks', async () => {
    expect('locks' in navigator).toBe(false)
    const release = holdStepUpWait()
    expect(release).not.toThrow()
    await expect(isStepUpWaitHeld()).resolves.toBeNull()
  })
})
