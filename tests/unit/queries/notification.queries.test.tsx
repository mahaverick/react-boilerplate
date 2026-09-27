import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import {
  notificationKeys,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  usePreferences,
  useUpdatePreferences,
} from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import { NOTIFICATION_ID, USER_ID } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * The preferences card is read-only today, because every notification type is
 * non-configurable server-side. These tests are what keep the WIRE SHAPE
 * honest in the meantime: the endpoints are nothing like the flat
 * `Record<string, boolean>` they are easy to assume, and nothing in the UI
 * exercises them any more. See useUpdatePreferences' own comment.
 */
describe('notification preference queries', () => {
  let client: QueryClient

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
    // GET answers `{ preferences: [...] }`, not a bare array — and the matrix
    // always lists EVERY known type with defaults resolved, not just the rows
    // this user has explicitly set.
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          {
            preferences: [
              { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
            ],
          },
          'Notification preferences retrieved.'
        )
      )
    )

    const { result } = renderHook(() => usePreferences(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
    ])
  })

  it('PUTs a whole entry inside a `preferences` array', async () => {
    // `updatePreferencesSchema` requires an array (min 1) of entries carrying
    // BOTH channel booleans. A flat body, or one channel on its own, is a 400.
    let body: unknown
    server.use(
      http.put('/api/v1/notifications/preferences', async ({ request }) => {
        body = await request.json()
        return ok({ preferences: [] }, 'Notification preferences updated.')
      })
    )

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper })
    result.current.mutate({
      notificationType: 'verify_email',
      emailEnabled: false,
      inAppEnabled: true,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({
      preferences: [{ notificationType: 'verify_email', emailEnabled: false, inAppEnabled: true }],
    })
  })
})

/**
 * The list and the preferences live under one `notifications` prefix. A list
 * mutation that invalidated or cancelled by that prefix would refetch the
 * preferences too, a request whose answer cannot have changed.
 */
describe('notification list mutations', () => {
  const UNREAD = {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: 'verify_email',
    title: 'Confirm your email',
    body: 'We sent a link to a@b.com.',
    metadata: null,
    readAt: null,
    createdAt: '2026-01-02T09:00:00.000Z',
  }

  let client: QueryClient
  let listRequests: number
  let preferenceRequests: number

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** Every hook at once, so the preferences query has a live observer to refetch. */
  function useAll() {
    return {
      list: useNotifications(),
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
        return ok({ notifications: [UNREAD] }, 'Notifications retrieved.')
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

    // The list really was invalidated, so the assertions below are not vacuous.
    await waitFor(() => {
      expect(listRequests).toBeGreaterThan(listBefore)
    })
    expect(preferenceRequests).toBe(1)
    const preferences = client.getQueryState(notificationKeys.preferences)
    expect(preferences?.dataUpdatedAt).toBe(preferencesUpdatedAt)
    expect(preferences?.isInvalidated).toBe(false)
  })
})
