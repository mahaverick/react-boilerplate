/**
 * @file A stand-in for `navigator.locks`, which jsdom lacks. It grants every
 * request at once, shared or exclusive, and reports what is held, which is
 * all the step-up wait and the refresh lock need from it. Call
 * `removeWebLocks()` after each test, so the next one sees jsdom's default.
 */

/** One held lock, as `navigator.locks.query()` reports it. */
interface HeldLock {
  name: string
  mode: LockMode
}

/** The stub's record: every request in order, and the locks held now. */
export interface WebLocksStub {
  requests: { name: string; mode: LockMode }[]
  held: HeldLock[]
  /** How many times `query()` ran. */
  queries: number
}

/**
 * Installs the stub on `navigator.locks`.
 * @param onQuery - Runs on every `query()`, before it answers, so a test can order it against other events.
 * @returns The stub's live record.
 */
export function stubWebLocks(onQuery: () => void = () => {}): WebLocksStub {
  const stub: WebLocksStub = { requests: [], held: [], queries: 0 }
  const locks = {
    async request(
      name: string,
      optionsOrCallback: LockOptions | (() => Promise<unknown>),
      maybeCallback?: () => Promise<unknown>
    ): Promise<unknown> {
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      const lock: HeldLock = { name, mode: options.mode ?? 'exclusive' }
      stub.requests.push(lock)
      stub.held.push(lock)
      try {
        return await callback?.()
      } finally {
        stub.held.splice(stub.held.indexOf(lock), 1)
      }
    },
    query(): Promise<{ held: HeldLock[]; pending: HeldLock[] }> {
      stub.queries += 1
      onQuery()
      return Promise.resolve({ held: [...stub.held], pending: [] })
    },
  }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return stub
}

/** Takes the stub off `navigator`, back to jsdom's missing `locks`. */
export function removeWebLocks(): void {
  Reflect.deleteProperty(navigator, 'locks')
}
