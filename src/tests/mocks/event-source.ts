/**
 * Enough of `EventSource` to drive `useNotificationStream`, and no more.
 *
 * `listeners` is a map keyed by event NAME, not a single `onmessage` slot,
 * because that distinction is load-bearing: the server writes
 * `event: notification`, and a browser dispatches a named frame only to
 * listeners registered for that name.
 *
 * Shared rather than copied. `tests/setup.ts` installs an IDLE stub globally
 * so that every test which merely mounts `AppLayout` has an `EventSource` to
 * construct; the tests that actually drive the stream — the hook's own, and
 * the tenants page's combined signed-out path — need to dispatch frames and
 * fire `onerror`, and two copies of that would be two chances to drift.
 */
export class MockEventSource {
  static instances: MockEventSource[] = []
  onerror: ((event: Event) => void) | null = null
  closed = false
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const existing = this.listeners.get(type) ?? new Set<(event: Event) => void>()
    existing.add(listener)
    this.listeners.set(type, existing)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  /** Deliver one frame, exactly as the browser would: by event name only. */
  dispatch(type: string, data?: string): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** The most recently constructed connection. */
export function latestEventSource(): MockEventSource {
  const instance = MockEventSource.instances.at(-1)
  if (!instance) throw new Error('no EventSource was opened')
  return instance
}
