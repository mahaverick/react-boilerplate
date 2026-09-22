import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationStream } from '@/hooks/use-notifications'
import { resetSessionForTests } from '@/http/session'
import {
  notificationKeys,
  useNotifications,
  type Notification,
  type NotificationStreamPayload,
} from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * Enough of `EventSource` to drive the hook, and no more.
 *
 * `listeners` is a map keyed by event NAME, not a single `onmessage` slot,
 * because that distinction is the whole point of the third test: the server
 * writes `event: notification`, and a browser dispatches a named frame only
 * to listeners registered for that name.
 */
class MockEventSource {
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

function latest(): MockEventSource {
  const instance = MockEventSource.instances.at(-1)
  if (!instance) throw new Error('no EventSource was opened')
  return instance
}

const streamPayload: NotificationStreamPayload = {
  id: 'n1',
  type: 'verify_email',
  title: 'Verify your email',
  body: 'Follow the link we sent you.',
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

/** The same notification as a LIST row: it carries userId and metadata too. */
const listRow: Notification = {
  id: 'n1',
  userId: testUser.id,
  type: 'verify_email',
  title: 'Verify your email',
  body: 'Follow the link we sent you.',
  metadata: null,
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

describe('useNotificationStream', () => {
  // Hoisted, not created inside the wrapper: a client built per render would
  // be a different cache on every re-render, and these tests inspect it.
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'tok-a',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // Restores the idle no-op from tests/setup.ts, not `undefined`.
    vi.unstubAllGlobals()
    client.clear()
  })

  it('puts the access token in the query string', () => {
    // EventSource cannot set an Authorization header, which is exactly
    // why /notifications/stream authenticates from ?token=.
    renderHook(() => useNotificationStream(), { wrapper })

    expect(MockEventSource.instances).toHaveLength(1)
    expect(latest().url).toContain('/api/v1/notifications/stream')
    expect(latest().url).toContain('token=tok-a')
  })

  it('tears down and rebuilds when the token changes', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    expect(MockEventSource.instances).toHaveLength(1)

    act(() => useAuthStore.getState().setToken('tok-b'))

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(MockEventSource.instances[0]!.closed).toBe(true)
    expect(latest().url).toContain('token=tok-b')
  })

  it('delivers a NAMED `notification` frame into the query cache', async () => {
    // The listener is registered with addEventListener('notification'), not
    // onmessage — the server writes `event: notification`, and onmessage
    // fires only for UNNAMED frames. Registered the wrong way, this hook
    // would be inert with no error anywhere; this test is what catches that.
    const { result } = renderHook(
      () => {
        useNotificationStream()
        return useNotifications()
      },
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pages[0]?.notifications).toHaveLength(0)

    server.use(
      http.get('/api/v1/notifications', () =>
        ok({ notifications: [listRow] }, 'Notifications retrieved.')
      )
    )

    act(() => latest().dispatch('notification', JSON.stringify(streamPayload)))

    await waitFor(() => expect(result.current.data?.pages[0]?.notifications).toEqual([listRow]))
  })

  it('ignores an unnamed frame, and invalidates on a named one', () => {
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })

    // `message` is what `onmessage` would have caught. The server never sends
    // an unnamed frame, so this must be a no-op.
    act(() => latest().dispatch('message', JSON.stringify(streamPayload)))
    expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(false)

    act(() => latest().dispatch('notification', JSON.stringify(streamPayload)))
    expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(true)
  })

  it('refetches on open, because a fresh EventSource sends no Last-Event-ID', () => {
    // The server replays what was missed during a disconnect only from a
    // Last-Event-ID header, which a newly constructed EventSource never
    // sends. Refetching on open is what recovers those notifications.
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })

    act(() => latest().dispatch('open'))

    expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(true)
  })

  it('does NOT let a bare open reset the backoff', async () => {
    // A backend that accepts the connection and immediately drops it fires
    // `open` on every attempt. If `open` reset the backoff, the retry would
    // stay pinned at one second — and each retry calls ensureSession(), which
    // rotates the refresh cookie. Only a delivered frame may reset it.
    renderHook(() => useNotificationStream(), { wrapper })

    act(() => latest().onerror?.(new Event('error')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))

    // The connection came up, then died — exactly the flapping case.
    act(() => latest().dispatch('open'))
    act(() => latest().onerror?.(new Event('error')))

    // One second is no longer enough: the interval has doubled to two.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(MockEventSource.instances).toHaveLength(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(3))
  })

  it('closes and reconnects through ensureSession after an error', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      )
    )
    renderHook(() => useNotificationStream(), { wrapper })
    const first = latest()

    act(() => first.onerror?.(new Event('error')))
    expect(first.closed).toBe(true)

    // The first retry waits one backoff interval before reconnecting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(latest().url).toContain('token=fresh-token')
    // Exactly two: the refreshed token re-runs the effect, and the effect
    // re-run owns the reconnect. A second connect from inside the retry's
    // own `.then` would open a third, immediately-torn-down connection.
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('survives a transient outage and reconnects, without ending the session', async () => {
    // The whole point of routing errors through ensureSession(): the API
    // being briefly unreachable is not a verdict on the session. The first
    // retry cannot reach the server, the session must survive that, and the
    // second retry — one doubled interval later — must still happen.
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.error()
          : ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )
    renderHook(() => useNotificationStream(), { wrapper })

    act(() => latest().onerror?.(new Event('error')))

    // Retry 1, at 1s: the API is down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(attempts).toBe(1)
    expect(MockEventSource.instances).toHaveLength(1)
    // The session was never judged, so it is still here.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe('tok-a')

    // Retry 2, one doubled interval later: the API is back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(latest().url).toContain('token=fresh-token')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('stops retrying once the session is genuinely dead', async () => {
    server.use(
      http.post(
        '/api/v1/auth/refresh',
        () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Unauthorized',
              statusCode: 401,
              requestId: 'r',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
      )
    )
    renderHook(() => useNotificationStream(), { wrapper })
    act(() => latest().onerror?.(new Event('error')))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    // ensureSession rejected and logged out; no second connection.
    expect(MockEventSource.instances).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper })
    unmount()
    expect(MockEventSource.instances[0]!.closed).toBe(true)
  })

  it('opens no connection at all without a token', () => {
    useAuthStore.setState({ accessToken: null, isAuthenticated: false })
    renderHook(() => useNotificationStream(), { wrapper })
    expect(MockEventSource.instances).toHaveLength(0)
  })
})
