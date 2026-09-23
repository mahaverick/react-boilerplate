import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_PREFIX } from '@/constants/routes'
import { useNotificationStream } from '@/hooks/use-notifications'
import { resetSessionForTests } from '@/http/session'
import {
  notificationKeys,
  useNotifications,
  type Notification,
} from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import {
  latestFetchStream as latest,
  MockFetchStream,
  queueConnectRefusal,
  stubStreamFetch,
} from '@/tests/mocks/fetch-stream'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const STREAM_URL = `${API_PREFIX}/notifications/stream`

/**
 * What the server actually puts on a `notification` frame's `data:` line —
 * NOT a list row. `toStreamPayload` (notification-stream.controller.ts)
 * narrows the row to these six fields, dropping `userId` (the connection is
 * already scoped to one user) and `metadata`.
 *
 * Typed by subtraction from `Notification` rather than through a hand-written
 * interface of its own. There WAS one, exported from notification.queries.ts,
 * and nothing but this fixture ever referenced it: it was residue of the
 * superseded design in which the hook wrote frames into the cache with
 * `setQueryData`. The hook invalidates instead, so no production code reads
 * this shape at all — but the frame is still narrower than a row, and saying
 * so here keeps the fixture honest without shipping a type for it.
 */
const streamPayload: Omit<Notification, 'userId' | 'metadata'> = {
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
    MockFetchStream.instances = []
    stubStreamFetch(STREAM_URL)
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
    // Restores whatever fetch setup.ts's own globals had before this test's
    // stub, not `undefined`.
    vi.unstubAllGlobals()
    client.clear()
  })

  it('sends the access token as a Bearer header, never in the URL', async () => {
    // The whole point of the fetch transport: EventSource could only
    // authenticate via `?token=`, which lands in browser history, `Referer`
    // and any log that records request lines. fetch can set headers, so the
    // credential moves to one instead.
    renderHook(() => useNotificationStream(), { wrapper })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    expect(latest().url).toContain('/api/v1/notifications/stream')
    expect(latest().url).not.toContain('token=')
    expect(latest().headers.Authorization).toBe('Bearer tok-a')
  })

  it('sends no Last-Event-ID on the very first connect', async () => {
    // There is nothing to replay yet — this hook has not seen an id. The
    // header must be ABSENT, not present-and-empty: `EventSource` never gave
    // a server a way to tell "no id yet" from "id is the empty string", and
    // this transport must not reintroduce that ambiguity.
    renderHook(() => useNotificationStream(), { wrapper })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    expect('Last-Event-ID' in latest().headers).toBe(false)
  })

  it('sends Last-Event-ID with the id of the last delivered event, on reconnect', async () => {
    // The whole point of the transport switch: a reconnect now tells the
    // server what it missed, so the server's replay can actually fire. A
    // wrong id here means silently duplicated or silently missed
    // notifications, so the header must carry the id from the event that
    // ACTUALLY ARRIVED — not the first connect (which sent none) and not a
    // stale one from an earlier delivery.
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })

    // Let the initial connect's own refetchList() settle before isolating
    // the delivered event's effect, same reason as the unnamed-frame test
    // below.
    await waitFor(() =>
      expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(true)
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    act(() =>
      latest().dispatch({ id: 'n7', event: 'notification', data: JSON.stringify(streamPayload) })
    )
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))

    latest().fail()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers['Last-Event-ID']).toBe('n7')
  })

  it('tears down and rebuilds when the token changes', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    act(() => useAuthStore.getState().setToken('tok-b'))

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(MockFetchStream.instances[0]!.aborted).toBe(true)
    expect(latest().headers.Authorization).toBe('Bearer tok-b')
  })

  it('delivers a NAMED `notification` frame into the query cache', async () => {
    // The check is against `event.event`, not against every frame — the
    // server writes `event: notification`, and a frame with no event name
    // must not be treated as one. Registered the wrong way, this hook would
    // be inert with no error anywhere; this test is what catches that.
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

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    act(() =>
      latest().dispatch({ id: 'n1', event: 'notification', data: JSON.stringify(streamPayload) })
    )

    await waitFor(() => expect(result.current.data?.pages[0]?.notifications).toEqual([listRow]))
  })

  it('ignores an unnamed frame, and invalidates on a named one', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })

    // The connect itself invalidates the list once (see the next test) —
    // let that settle before isolating the frame-level effect below, so the
    // spy only counts invalidations the two dispatched frames cause.
    await waitFor(() =>
      expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(true)
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    // A frame with no `event:` line parses to `event: undefined`, which is
    // what an unnamed frame becomes — the server never sends one, but this
    // must be a no-op if it ever did. Asserted on the spy, not on
    // `isInvalidated` alone: a fixed-length flush cannot prove a negative
    // (it only proves nothing happened to have arrived YET), but a call
    // count pinned at exactly one after the second frame proves the first
    // one truly never invalidated anything.
    act(() => latest().dispatch({ data: JSON.stringify(streamPayload) }))
    act(() => latest().dispatch({ event: 'notification', data: JSON.stringify(streamPayload) }))

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })

  it('invalidates the list on every successful connect, which is what recovers the very first connect', async () => {
    // A reconnect now sends `Last-Event-ID`, so the server CAN replay what
    // it missed, but the very first connect has no id yet and definitely
    // gets none — refetching on every connect is what covers that one case.
    // (React Query dedupes this against whatever else invalidates around
    // it, so the common case costs nothing.)
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })

    await waitFor(() =>
      expect(client.getQueryState(notificationKeys.list)?.isInvalidated).toBe(true)
    )
  })

  it('does NOT let a connect with no delivered frame reset the backoff', async () => {
    // A backend that accepts the connection and immediately drops it ends
    // the stream with no frame ever delivered. If that reset the backoff,
    // the retry would stay pinned at one second — and each retry calls
    // ensureSession(), which rotates the refresh cookie. Only a delivered
    // notification frame may reset it.
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().end()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))

    // The connection came up, then ended with nothing delivered — exactly
    // the flapping case.
    latest().end()

    // One second is no longer enough: the interval has doubled to two.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(MockFetchStream.instances).toHaveLength(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(3))
  })

  it('treats a non-ok connect response as a refused connect, not a delivered frame, and recovers exactly like a mid-stream failure', async () => {
    // The one behaviour `fetch` invented over `EventSource`: the two collapsed
    // into a single `onerror`, and a non-ok CONNECT response is the half that
    // was never covered anywhere — every other test in this file fails via
    // `latest().fail()`, a MID-STREAM rejection, after the connect already
    // succeeded with `status: 200`.
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      )
    )
    queueConnectRefusal({
      status: 401,
      body: {
        success: false,
        message: 'Access token expired',
        statusCode: 401,
        code: 'ACCESS_TOKEN_EXPIRED',
        requestId: 'r',
      },
    })
    client.setQueryData(notificationKeys.list, { pages: [{ notifications: [] }], pageParams: [] })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    // No frame ever arrives from a refused connect: `!response.ok` throws
    // before the `for await` loop — and before the unconditional
    // `refetchList()` every successful connect makes (see "invalidates the
    // list on every successful connect" above) — so nothing here ever
    // invalidates the list.
    expect(invalidate).not.toHaveBeenCalled()

    // The same recovery a mid-stream failure gets: one backoff interval,
    // then a reconnect that goes through ensureSession() first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer fresh-token')
  })

  it('reconnects through ensureSession after a stream failure', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      )
    )
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().fail()

    // The first retry waits one backoff interval before reconnecting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer fresh-token')
    // Exactly two: the refreshed token re-runs the effect, and the effect
    // re-run owns the reconnect. A second connect from inside the retry's
    // own `.then` would open a third, immediately-torn-down connection.
    expect(MockFetchStream.instances).toHaveLength(2)
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
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().fail()

    // Retry 1, at 1s: the API is down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(attempts).toBe(1)
    expect(MockFetchStream.instances).toHaveLength(1)
    // The session was never judged, so it is still here.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe('tok-a')

    // Retry 2, one doubled interval later: the API is back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer fresh-token')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('stops retrying once the session is genuinely dead, and sends the user to /login', async () => {
    // The redirect is the half that was missing. `logout()` clears the store
    // and nothing else moves the user — no errorComponent, no store
    // subscription, no router.invalidate, and `_app.beforeLoad` only runs on
    // navigation — so a still tab stayed on /dashboard, signed out, showing
    // cached data. jsdom's location is unforgeable, hence the stub.
    const assign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: `${window.location.origin}/dashboard`,
      pathname: '/dashboard',
      search: '',
      hash: '',
      assign,
    })
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
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().fail()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    // ensureSession rejected and logged out; no second connection.
    expect(MockFetchStream.instances).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    // …and the user is actually moved, carrying where they were.
    expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/dashboard')}`)
  })

  it('aborts the connection on unmount', async () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    unmount()
    expect(MockFetchStream.instances[0]!.aborted).toBe(true)
  })

  it('opens no connection at all without a token', () => {
    useAuthStore.setState({ accessToken: null, isAuthenticated: false })
    renderHook(() => useNotificationStream(), { wrapper })
    expect(MockFetchStream.instances).toHaveLength(0)
  })
})
