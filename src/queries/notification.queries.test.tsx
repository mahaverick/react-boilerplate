import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { usePreferences, useUpdatePreferences } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
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
