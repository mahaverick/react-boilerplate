import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_PREFIX } from '@/constants/routes'
import { useNotificationStream } from '@/hooks/use-notifications'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { notificationsListOptions, type Notification } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import { NOTIFICATION_ID, NOTIFICATION_ID_7 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import {
  latestFetchStream as latest,
  MockFetchStream,
  queueConnectRefusal,
  stubStreamFetch,
  type ConnectRefusal,
} from '@/tests/mocks/fetch-stream'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const STREAM_URL = `${API_PREFIX}/notifications/stream`

/**
 * What the server puts on a `notification` frame's `data:` line, which is not a list row:
 * `toStreamPayload` (notification-stream.controller.ts) narrows the row to these six
 * fields, dropping `userId` (the connection is already scoped to one user) and `metadata`.
 * Typed by subtraction from `Notification` because no production code reads this shape:
 * the hook invalidates the query instead of writing frames into the cache.
 */
const streamPayload: Omit<Notification, 'userId' | 'metadata'> = {
  id: NOTIFICATION_ID,
  type: 'tenant_invitation',
  title: 'You are invited to Acme',
  body: 'A B invited you to join Acme Corp.',
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

/** The same notification as a list row, which carries `userId` and `metadata` too. */
const listRow: Notification = {
  id: NOTIFICATION_ID,
  userId: testUser.id,
  type: 'tenant_invitation',
  title: 'You are invited to Acme',
  body: 'A B invited you to join Acme Corp.',
  metadata: null,
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

describe('useNotificationStream', () => {
  /** Hoisted, not created in the wrapper: a client built per render would be a new cache on every re-render, and these tests inspect it. */
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
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
    // The toast spy is on a module shared by every test, unlike the per-test client.
    vi.restoreAllMocks()
    // Restores the `fetch` that existed before this test's stub, not `undefined`.
    vi.unstubAllGlobals()
    client.clear()
  })

  /**
   * A page load opens the stream once per token. StrictMode's second effect run aborts the
   * first connect, so one connection stays live. The plain-mount half settles one microtask
   * turn only, so a reconnect on a backoff timer is out of scope.
   */
  it('opens one stream per token per mount, StrictMode included', async () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {})
    expect(MockFetchStream.instances).toHaveLength(1)
    unmount()

    MockFetchStream.instances = []
    const strict = renderHook(() => useNotificationStream(), { wrapper, reactStrictMode: true })
    // Two connects prove StrictMode's mount-unmount-mount ran; the first must be aborted.
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    await act(async () => {})
    expect(MockFetchStream.instances.map((stream) => stream.aborted)).toEqual([true, false])
    strict.unmount()
  })

  /**
   * The reason for the fetch transport: `EventSource` could only authenticate via
   * `?token=`, which lands in browser history, `Referer` and request-line logs, while
   * `fetch` can send the credential in a header.
   */
  it('sends the access token as a Bearer header, never in the URL', async () => {
    renderHook(() => useNotificationStream(), { wrapper })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    expect(latest().url).toContain('/api/v1/notifications/stream')
    expect(latest().url).not.toContain('token=')
    expect(latest().headers.Authorization).toBe('Bearer tok-a')
  })

  /**
   * Nothing to replay yet, as no id has been seen. The header must be absent, not empty:
   * `EventSource` gave a server no way to tell "no id yet" from "id is the empty string",
   * and this transport must not reintroduce that ambiguity.
   */
  it('sends no Last-Event-ID on the very first connect', async () => {
    renderHook(() => useNotificationStream(), { wrapper })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    expect('Last-Event-ID' in latest().headers).toBe(false)
  })

  /**
   * A reconnect tells the server what it missed, so its replay can fire. A wrong id means
   * duplicated or missed notifications, so the header must carry the id of the event that
   * arrived, not a stale one from an earlier delivery.
   */
  it('sends Last-Event-ID with the id of the last delivered event, on reconnect', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationsListOptions({}).queryKey, listPage([]))

    // Wait for the initial connect's own refetch before isolating the delivered event's effect, as in the unnamed-frame test below.
    await waitFor(() =>
      expect(client.getQueryState(notificationsListOptions({}).queryKey)?.isInvalidated).toBe(true)
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    act(() =>
      latest().dispatch({
        id: NOTIFICATION_ID_7,
        event: 'notification',
        data: JSON.stringify(streamPayload),
      })
    )
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))

    latest().fail()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers['Last-Event-ID']).toBe(NOTIFICATION_ID_7)
  })

  it('tears down and rebuilds when the token changes', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    act(() => useAuthStore.setState({ accessToken: 'tok-b' }))

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(MockFetchStream.instances[0]!.aborted).toBe(true)
    expect(latest().headers.Authorization).toBe('Bearer tok-b')
  })

  /**
   * The server writes `event: notification`, and the hook checks `event.event`, so a frame
   * with no event name is not treated as one. A wrong event name would leave the hook inert
   * with no error anywhere; this test is what catches that.
   */
  it('delivers a NAMED `notification` frame into the query cache', async () => {
    const { result } = renderHook(
      () => {
        useNotificationStream()
        return useQuery(notificationsListOptions({}))
      },
      { wrapper }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(0)

    server.use(
      http.get('/api/v1/notifications', () => ok(listPage([listRow]), 'Notifications retrieved.'))
    )

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    act(() =>
      latest().dispatch({
        id: NOTIFICATION_ID,
        event: 'notification',
        data: JSON.stringify(streamPayload),
      })
    )

    await waitFor(() => expect(result.current.data?.items).toEqual([listRow]))
  })

  /**
   * The connect itself invalidates the list once (see the next test), so the test waits for
   * that before spying, and the spy counts only what the two dispatched frames cause.
   *
   * A frame with no `event:` line parses to `event: undefined`; the server never sends one,
   * but it must be a no-op. Asserted on the spy, not on `isInvalidated`: waiting a fixed
   * time cannot prove a negative, but a count of exactly one after the second frame proves
   * the first invalidated nothing.
   */
  it('ignores an unnamed frame, and invalidates on a named one', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationsListOptions({}).queryKey, listPage([]))

    await waitFor(() =>
      expect(client.getQueryState(notificationsListOptions({}).queryKey)?.isInvalidated).toBe(true)
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    act(() => latest().dispatch({ data: JSON.stringify(streamPayload) }))
    act(() => latest().dispatch({ event: 'notification', data: JSON.stringify(streamPayload) }))

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })

  /**
   * A reconnect sends `Last-Event-ID` so the server can replay, but the first connect has
   * no id and gets no replay, so refetching on every connect covers that case. React Query
   * dedupes the invalidation against others around it.
   */
  it('invalidates the list on every successful connect, which is what recovers the very first connect', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    client.setQueryData(notificationsListOptions({}).queryKey, listPage([]))

    await waitFor(() =>
      expect(client.getQueryState(notificationsListOptions({}).queryKey)?.isInvalidated).toBe(true)
    )
  })

  /**
   * A backend that accepts the connection and drops it ends the stream with no frame
   * delivered. If that reset the backoff, the retry would stay pinned at one second, and
   * each retry calls ensureSession(), which rotates the refresh cookie. Only a delivered
   * notification frame may reset it.
   */
  it('does NOT let a connect with no delivered frame reset the backoff', async () => {
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().end()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))

    // The connection came up and ended with nothing delivered: the flapping case.
    latest().end()

    // One second is not enough now: the interval has doubled to two.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(MockFetchStream.instances).toHaveLength(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(3))
  })

  /**
   * `EventSource` collapsed a refused connect and a mid-stream drop into one `onerror`;
   * `fetch` tells them apart. A non-ok connect response is covered only here: the other
   * failure tests use `latest().fail()`, a mid-stream rejection after a 200 connect.
   */
  it('treats a non-ok connect response as a refused connect, not a delivered frame, and recovers exactly like a mid-stream failure', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      )
    )
    queueConnectRefusal({
      status: 401,
      body: {
        success: false,
        message: 'Your sign-in expired. Sign in again to continue.',
        statusCode: 401,
        code: 'ACCESS_TOKEN_EXPIRED',
        requestId: 'r',
      },
    })
    client.setQueryData(notificationsListOptions({}).queryKey, listPage([]))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    // `!response.ok` throws before the `for await` loop and before the `refetchList()` every successful connect makes (see "invalidates the list on every successful connect"), so a refused connect invalidates nothing.
    expect(invalidate).not.toHaveBeenCalled()

    // Recovers like a mid-stream failure: one backoff interval, then a reconnect through ensureSession().
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer fresh-token')
  })

  /** express's 503 at its process-wide stream cap (`didRefuseStream`). */
  const STREAM_CAPACITY: ConnectRefusal = {
    status: 503,
    body: {
      success: false,
      message:
        'Notifications are at capacity on this server. Reload this page in 30 seconds to try again.',
      statusCode: 503,
      code: 'stream_capacity',
      requestId: 'r',
    },
  }

  /**
   * Counts every `/auth/refresh` call, answering each with a fresh token.
   * @returns A reader for the count so far.
   */
  function countRefreshes(): () => number {
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      })
    )
    return () => refreshes
  }

  it('treats a 503 at stream capacity as a refused connect: backoff and retry, no refresh, no toast, still signed in', async () => {
    const refreshes = countRefreshes()
    queueConnectRefusal(STREAM_CAPACITY)
    const toastError = vi.spyOn(toast, 'error')

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    // A full stream server says nothing about the session, so the same token reconnects with no refresh.
    expect(latest().headers.Authorization).toBe('Bearer tok-a')
    expect(refreshes()).toBe(0)
    expect(toastError).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('waits out a 503 Retry-After in seconds, plus jitter, before reconnecting', async () => {
    const refreshes = countRefreshes()
    // Jitter adds up to a fifth of the wait; at 0.5 that is a tenth, so 30 s becomes 33 s.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    queueConnectRefusal({ ...STREAM_CAPACITY, headers: { 'Retry-After': '30' } })

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000)
    })
    expect(MockFetchStream.instances).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer tok-a')
    expect(refreshes()).toBe(0)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('waits out a 503 Retry-After given as an HTTP date', async () => {
    countRefreshes()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const retryAt = new Date(Math.ceil((Date.now() + 45_000) / 1_000) * 1_000)
    queueConnectRefusal({ ...STREAM_CAPACITY, headers: { 'Retry-After': retryAt.toUTCString() } })

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_000)
    })
    expect(MockFetchStream.instances).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
  })

  it('holds a long Retry-After to the five-minute cap', async () => {
    countRefreshes()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    queueConnectRefusal({ ...STREAM_CAPACITY, headers: { 'Retry-After': '3600' } })

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_000)
    })
    expect(MockFetchStream.instances).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
  })

  it('reconnects within six minutes of a Retry-After date a year ahead', async () => {
    countRefreshes()
    // Nearly the most jitter possible: a fifth on top of the five-minute cap.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60_000)
    queueConnectRefusal({ ...STREAM_CAPACITY, headers: { 'Retry-After': nextYear.toUTCString() } })

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    // Not at once: an uncapped year-long delay exceeds setTimeout's 2^31-1 ms ceiling, which fires immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(290_000)
    })
    expect(MockFetchStream.instances).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
  })

  it('waits the backoff, not zero, on a Retry-After it cannot read', async () => {
    countRefreshes()
    queueConnectRefusal({ ...STREAM_CAPACITY, headers: { 'Retry-After': 'soon' } })

    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(MockFetchStream.instances).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
  })

  it('reconnects through ensureSession after a stream failure', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      )
    )
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().fail()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(2))
    expect(latest().headers.Authorization).toBe('Bearer fresh-token')
    // Exactly two: the refreshed token re-runs the effect, which owns the reconnect; a second connect from the retry's own `.then` would open a third connection that is torn down at once.
    expect(MockFetchStream.instances).toHaveLength(2)
  })

  /**
   * Errors go through ensureSession() because an API that is briefly unreachable is not a
   * verdict on the session: the first retry cannot reach the server, the session must
   * survive that, and the second retry, one doubled interval later, must still happen.
   */
  it('survives a transient outage and reconnects, without ending the session', async () => {
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.error()
          : ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      })
    )
    renderHook(() => useNotificationStream(), { wrapper })
    await waitFor(() => expect(MockFetchStream.instances).toHaveLength(1))

    latest().fail()

    // Retry 1, at 1 s: the API is down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(attempts).toBe(1)
    expect(MockFetchStream.instances).toHaveLength(1)
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

  /**
   * `logout()` clears the store and nothing else moves the user (`_app.beforeLoad` only
   * runs on navigation), so without this redirect an idle tab stays on /dashboard, signed
   * out, showing cached data. jsdom's location is unforgeable, hence the stub.
   */
  it('stops retrying once the session is genuinely dead, and sends the user to /login', async () => {
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

    // ensureSession rejected and logged out, so there is no second connection.
    expect(MockFetchStream.instances).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    // The redirect carries where the user was.
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
