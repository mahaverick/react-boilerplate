import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import {
  notificationKeys,
  notificationsListOptions,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  usePreferences,
  useUnreadCount,
  useUpdatePreferences,
  type Notification,
} from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import { NOTIFICATION_ID, NOTIFICATION_ID_2, USER_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ListPage } from '@/types/list.types'

/**
 * These tests keep the preference endpoints' wire shape honest: it is nothing like the flat
 * `Record<string, boolean>` that is easy to assume. See useUpdatePreferences' own comment.
 */
describe('notification preference queries', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('unwraps the matrix out of its `preferences` key', async () => {
    // GET answers `{ preferences: [...] }`, not a bare array, and the matrix lists every type the caller can see, with defaults resolved, not just the rows this user has set.
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          {
            preferences: [
              { notificationType: 'tenant_invitation', emailEnabled: true, inAppEnabled: true },
            ],
          },
          'Notification preferences retrieved.'
        )
      )
    )

    const { result } = renderHook(() => usePreferences(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { notificationType: 'tenant_invitation', emailEnabled: true, inAppEnabled: true },
    ])
  })

  it('PUTs a whole entry inside a `preferences` array', async () => {
    // `updatePreferencesSchema` requires an array (min 1) of entries carrying both channel booleans; a flat body, or one channel alone, is a 400.
    let body: unknown
    server.use(
      http.put('/api/v1/notifications/preferences', async ({ request }) => {
        body = await request.json()
        return ok({ preferences: [] }, 'Notification preferences updated.')
      })
    )

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper })
    result.current.mutate({
      notificationType: 'tenant_invitation',
      emailEnabled: true,
      inAppEnabled: true,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({
      preferences: [
        { notificationType: 'tenant_invitation', emailEnabled: true, inAppEnabled: true },
      ],
    })
  })
})

/** Does nothing; the gate's placeholder until its promise runs. */
function noop(): void {
  // Intentionally empty.
}

/** A gate a handler can wait on, and the call that opens it. */
function deferred() {
  let release: (value: void) => void = noop
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

/**
 * The list and the preferences live under one `notifications` prefix. A list
 * mutation that invalidated or cancelled by that prefix would refetch the
 * preferences too, a request whose answer cannot have changed.
 */
describe('notification list mutations', () => {
  const UNREAD = {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: 'tenant_invitation',
    title: 'You are invited to Acme',
    body: 'A B invited you to join Acme Corp.',
    metadata: null,
    readAt: null,
    createdAt: '2026-01-02T09:00:00.000Z',
  }

  let client: QueryClient
  let listRequests: number
  let preferenceRequests: number

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** Every hook at once, so the preferences query has a live observer to refetch. */
  function useAll() {
    return {
      list: useQuery(notificationsListOptions({})),
      unread: useUnreadCount(),
      preferences: usePreferences(),
      markRead: useMarkRead(),
      markAllRead: useMarkAllRead(),
      remove: useDeleteNotification(),
    }
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    listRequests = 0
    preferenceRequests = 0
    server.use(
      http.get('/api/v1/notifications', () => {
        listRequests += 1
        return ok(listPage([UNREAD], {}, { count: 1, capped: false }), 'Notifications retrieved.')
      }),
      http.get('/api/v1/notifications/preferences', () => {
        preferenceRequests += 1
        return ok({ preferences: [] }, 'Notification preferences retrieved.')
      }),
      http.patch('/api/v1/notifications/:id/read', () =>
        ok({ ...UNREAD, readAt: '2026-01-02T10:00:00.000Z' }, 'Notification marked as read.')
      ),
      http.patch('/api/v1/notifications/read-all', () =>
        ok({ count: 1 }, 'All notifications marked as read.')
      ),
      http.delete('/api/v1/notifications/:id', () => ok(null, 'Notification deleted.'))
    )
  })

  it.each([
    [
      'mark-read',
      (hooks: ReturnType<typeof useAll>) => hooks.markRead.mutateAsync(NOTIFICATION_ID),
    ],
    ['mark-all-read', (hooks: ReturnType<typeof useAll>) => hooks.markAllRead.mutateAsync()],
    ['delete', (hooks: ReturnType<typeof useAll>) => hooks.remove.mutateAsync(NOTIFICATION_ID)],
  ])('%s refetches the list and leaves the preferences alone', async (_name, run) => {
    const { result } = renderHook(() => useAll(), { wrapper })
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true)
      expect(result.current.preferences.isSuccess).toBe(true)
    })
    const listBefore = listRequests
    const preferencesUpdatedAt = client.getQueryState(notificationKeys.preferences)?.dataUpdatedAt

    await act(async () => {
      await run(result.current)
    })

    // The list was invalidated, so the assertions below are not vacuous.
    await waitFor(() => {
      expect(listRequests).toBeGreaterThan(listBefore)
    })
    expect(preferenceRequests).toBe(1)
    const preferences = client.getQueryState(notificationKeys.preferences)
    expect(preferences?.dataUpdatedAt).toBe(preferencesUpdatedAt)
    expect(preferences?.isInvalidated).toBe(false)
  })

  it('marks the row read on the full pages and drops it from the unread views', async () => {
    const all = notificationsListOptions({}).queryKey
    const unreadOnly = notificationsListOptions({ unread: true }).queryKey
    client.setQueryData(all, listPage([UNREAD]))
    client.setQueryData(unreadOnly, listPage([UNREAD]))
    // A refetch would overwrite the optimistic write; hold it so only that write is observed.
    server.use(http.get('/api/v1/notifications', () => delay('infinite')))
    const { result } = renderHook(() => useAll(), { wrapper })

    act(() => {
      result.current.markRead.mutate(NOTIFICATION_ID)
    })

    await waitFor(() => {
      expect(client.getQueryData<ListPage<Notification>>(all)?.items[0]?.readAt).toEqual(
        expect.any(String)
      )
      expect(client.getQueryData<ListPage<Notification>>(unreadOnly)?.items).toEqual([])
    })
  })

  describe('the unread count, before the request answers', () => {
    const countKey = notificationsListOptions({ unread: true, limit: 1 }).queryKey

    /** Seeds the count and one full page, and holds every read and write so only the optimistic edit shows. */
    function seed(total: ListPage<Notification>['total']) {
      client.setQueryData(countKey, listPage([UNREAD], {}, total))
      client.setQueryData(notificationsListOptions({}).queryKey, listPage([UNREAD]))
      server.use(
        http.get('/api/v1/notifications', () => delay('infinite')),
        http.patch('/api/v1/notifications/:id/read', () => delay('infinite')),
        http.patch('/api/v1/notifications/read-all', () => delay('infinite')),
        http.delete('/api/v1/notifications/:id', () => delay('infinite'))
      )
    }

    /** The cached unread total. */
    const total = () => client.getQueryData<ListPage<Notification>>(countKey)?.total

    it('drops by one when an unread row is marked read', async () => {
      seed({ count: 2, capped: false })
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
    })

    it('drops by one when an unread row is deleted, and the row leaves every page', async () => {
      seed({ count: 2, capped: false })
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.remove.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
      expect(
        client.getQueryData<ListPage<Notification>>(notificationsListOptions({}).queryKey)?.items
      ).toEqual([])
    })

    it('stays at the cap, where one fewer is still more than the cap', async () => {
      seed({ count: 1000, capped: true })
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
      })
      await waitFor(() =>
        expect(client.getQueryData<ListPage<Notification>>(countKey)?.items).toEqual([])
      )
      expect(total()).toEqual({ count: 1000, capped: true })
    })

    it('goes to zero when everything is marked read', async () => {
      seed({ count: 1000, capped: true })
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markAllRead.mutate()
      })
      await waitFor(() => expect(total()).toEqual({ count: 0, capped: false }))
    })

    /** A second unread row. */
    const OTHER = { ...UNREAD, id: NOTIFICATION_ID_2, title: 'Second' }
    /** The same row, read. */
    const READ = { ...UNREAD, readAt: '2026-01-02T10:00:00.000Z' }

    it('lowers each unread entry that holds the row once', async () => {
      seed({ count: 2, capped: false })
      const view = notificationsListOptions({ unread: true }).queryKey
      client.setQueryData(view, listPage([UNREAD], {}, { count: 5, capped: false }))
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
      expect(client.getQueryData<ListPage<Notification>>(view)?.total).toEqual({
        count: 4,
        capped: false,
      })
    })

    it('goes n, n-1, n-2 for two quick mark-reads', async () => {
      seed({ count: 3, capped: false })
      client.setQueryData(countKey, listPage([UNREAD, OTHER], {}, { count: 3, capped: false }))
      const { result } = renderHook(() => ({ a: useMarkRead(), b: useMarkRead() }), { wrapper })
      act(() => {
        result.current.a.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 2, capped: false }))
      act(() => {
        result.current.b.mutate(NOTIFICATION_ID_2)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
    })

    it('leaves the count alone for a row that was already read', async () => {
      seed({ count: 2, capped: false })
      client.setQueryData(countKey, listPage([], {}, { count: 2, capped: false }))
      client.setQueryData(notificationsListOptions({}).queryKey, listPage([READ]))
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
        result.current.remove.mutate(NOTIFICATION_ID)
      })
      await waitFor(() =>
        expect(
          client.getQueryData<ListPage<Notification>>(notificationsListOptions({}).queryKey)?.items
        ).toEqual([])
      )
      expect(total()).toEqual({ count: 2, capped: false })
    })

    it('shows the full pages read after mark-all-read', async () => {
      seed({ count: 2, capped: false })
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markAllRead.mutate()
      })
      await waitFor(() =>
        expect(
          client.getQueryData<ListPage<Notification>>(notificationsListOptions({}).queryKey)
            ?.items[0]?.readAt
        ).toEqual(expect.any(String))
      )
    })

    it('lowers a searched unread view only when the page holds the row', async () => {
      seed({ count: 2, capped: false })
      const holds = notificationsListOptions({ unread: true, search: 'confirm' }).queryKey
      const misses = notificationsListOptions({ unread: true, search: 'other' }).queryKey
      client.setQueryData(holds, listPage([UNREAD], {}, { count: 1, capped: false }))
      client.setQueryData(misses, listPage([OTHER], {}, { count: 1, capped: false }))
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
      expect(client.getQueryData<ListPage<Notification>>(holds)?.total?.count).toBe(0)
      expect(client.getQueryData<ListPage<Notification>>(misses)?.total?.count).toBe(1)
    })

    it("keeps another write's optimistic state when this one fails", async () => {
      seed({ count: 2, capped: false })
      const all = notificationsListOptions({}).queryKey
      client.setQueryData(countKey, listPage([UNREAD, OTHER], {}, { count: 2, capped: false }))
      client.setQueryData(all, listPage([UNREAD, OTHER]))
      let refused = false
      const { gate, release } = deferred()
      server.use(
        http.patch('/api/v1/notifications/:id/read', async ({ params }) => {
          if (params.id !== NOTIFICATION_ID) return delay('infinite')
          // A answers only once B has made its edit.
          await gate
          refused = true
          return fail('Not found', 404)
        })
      )
      const { result } = renderHook(() => ({ a: useMarkRead(), b: useMarkRead() }), { wrapper })
      act(() => {
        result.current.a.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(total()).toEqual({ count: 1, capped: false }))
      act(() => {
        result.current.b.mutate(NOTIFICATION_ID_2)
      })
      await waitFor(() => expect(total()).toEqual({ count: 0, capped: false }))
      release()
      await waitFor(() => expect(refused).toBe(true))
      await waitFor(() => expect(result.current.a.isError).toBe(true))

      const rows = client.getQueryData<ListPage<Notification>>(all)?.items
      expect(rows?.find((row) => row.id === NOTIFICATION_ID_2)?.readAt).toEqual(expect.any(String))
      // A's own edit waits for the last write's refetch; B's is not undone.
      expect(total()?.count).toBeLessThanOrEqual(1)
    })

    it('comes back when the request fails', async () => {
      seed({ count: 2, capped: false })
      let refused = false
      server.use(
        http.patch('/api/v1/notifications/:id/read', () => {
          refused = true
          return fail('Not found', 404)
        })
      )
      const { result } = renderHook(() => useAll(), { wrapper })
      act(() => {
        result.current.markRead.mutate(NOTIFICATION_ID)
      })
      await waitFor(() => expect(refused).toBe(true))
      await waitFor(() => expect(total()).toEqual({ count: 2, capped: false }))
    })
  })

  it('puts every cached page back when a mark-read fails', async () => {
    const all = notificationsListOptions({}).queryKey
    const unreadOnly = notificationsListOptions({ unread: true }).queryKey
    client.setQueryData(all, listPage([UNREAD]))
    client.setQueryData(unreadOnly, listPage([UNREAD]))
    let refused = false
    server.use(
      http.get('/api/v1/notifications', () => delay('infinite')),
      http.patch('/api/v1/notifications/:id/read', () => {
        refused = true
        return fail('Not found', 404)
      })
    )
    const { result } = renderHook(() => useAll(), { wrapper })

    // The settled invalidation waits on the held refetch, so the mutation is observed, not awaited.
    act(() => {
      result.current.markRead.mutate(NOTIFICATION_ID)
    })
    await waitFor(() => expect(refused).toBe(true))

    await waitFor(() => {
      expect(client.getQueryData<ListPage<Notification>>(all)?.items[0]?.readAt).toBeNull()
      expect(client.getQueryData<ListPage<Notification>>(unreadOnly)?.items[0]?.readAt).toBeNull()
    })
  })

  it('reads the unread count as the capped total of the unread view', async () => {
    let seen: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        seen = new URL(request.url).searchParams
        return ok(listPage([UNREAD], {}, { count: 1000, capped: true }), 'Notifications retrieved.')
      })
    )
    const { result } = renderHook(() => useUnreadCount(), { wrapper })

    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.data).toEqual({ count: 1000, capped: true }))
    expect(seen?.get('unread')).toBe('true')
    expect(seen?.get('limit')).toBe('1')
    expect(seen?.get('total')).toBe('1')
  })

  it('refetches the unread count when a row is marked read', async () => {
    const { result } = renderHook(() => useAll(), { wrapper })
    await waitFor(() => expect(result.current.unread.isSuccess).toBe(true))
    const before = listRequests

    await act(async () => {
      await result.current.markRead.mutateAsync(NOTIFICATION_ID)
    })

    await waitFor(() => expect(listRequests).toBeGreaterThanOrEqual(before + 2))
  })
})
