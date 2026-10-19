import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import { resetSessionForTests } from '@/http/session'
import { track, yieldSharedIdentity } from '@/observability/telemetry'
import {
  invitationKeys,
  inviterName,
  useAcceptInvitation,
  useConfirmInvitation,
  useInvitationPreview,
  useVerifyInvitation,
} from '@/queries/invitation.queries'
import { myTenantsListOptions, tenantKeys, useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import {
  fail,
  ok,
  TEST_INVITATION_TOKEN,
  testInvitationPreview,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
  yieldSharedIdentity: vi.fn(),
}))

describe('invitation queries', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    // `retry: 1` like the router's client, with no delay, so the preview's own retry rule is what decides.
    client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    resetSessionForTests()
    vi.mocked(track).mockReset()
    vi.mocked(yieldSharedIdentity).mockReset()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  describe('useInvitationPreview', () => {
    it('posts the token in the body and sends NO bearer token, even when signed in', async () => {
      let body: unknown
      let search: string | null = null
      let authorization: string | null = 'unset'
      server.use(
        http.post('/api/v1/invitations/preview', async ({ request }) => {
          body = await request.json()
          search = new URL(request.url).search
          authorization = request.headers.get('authorization')
          return ok(testInvitationPreview, 'Invitation retrieved.')
        })
      )

      const { result } = renderHook(() => useInvitationPreview(TEST_INVITATION_TOKEN), {
        wrapper,
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(testInvitationPreview)
      expect(body).toEqual({ token: TEST_INVITATION_TOKEN })
      // The token stays out of the URL, where logs and history would keep it.
      expect(search).toBe('')
      expect(authorization).toBeNull()
    })

    it('never reads a 401 as a session verdict', async () => {
      server.use(http.post('/api/v1/invitations/preview', () => fail('Unauthorized', 401)))

      const { result } = renderHook(() => useInvitationPreview(TEST_INVITATION_TOKEN), {
        wrapper,
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useAuthStore.getState().accessToken).toBe('access-token')
    })

    it('does not retry a 404, which is the answer rather than a failure', async () => {
      let calls = 0
      server.use(
        http.post('/api/v1/invitations/preview', () => {
          calls += 1
          return fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
        })
      )

      const { result } = renderHook(() => useInvitationPreview(TEST_INVITATION_TOKEN), {
        wrapper,
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
    })

    it('retries any other failure once', async () => {
      let calls = 0
      server.use(
        http.post('/api/v1/invitations/preview', () => {
          calls += 1
          return fail('Something went wrong.', 500)
        })
      )

      const { result } = renderHook(() => useInvitationPreview(TEST_INVITATION_TOKEN), {
        wrapper,
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(2)
    })

    it('asks nothing when there is no token', () => {
      let calls = 0
      server.use(
        http.post('/api/v1/invitations/preview', () => {
          calls += 1
          return ok(testInvitationPreview, 'Invitation retrieved.')
        })
      )

      const { result } = renderHook(() => useInvitationPreview(undefined), { wrapper })

      expect(result.current.fetchStatus).toBe('idle')
      expect(calls).toBe(0)
      expect(invitationKeys.preview('t')).toEqual(['invitations', 'preview', 't'])
    })
  })

  describe('useAcceptInvitation', () => {
    it('posts the token with the bearer token and returns the tenant', async () => {
      let body: unknown
      let authorization: string | null = null
      server.use(
        http.post('/api/v1/invitations/accept', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok({ tenant: { name: 'Acme Corp', slug: 'acme' }, role: 'editor' }, 'Accepted.')
        })
      )

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: TEST_INVITATION_TOKEN })
      expect(authorization).toBe('Bearer access-token')
      expect(result.current.data).toEqual({
        tenant: { name: 'Acme Corp', slug: 'acme' },
        role: 'editor',
      })
    })

    it('drops the cached pre-membership tenant and refreshes the tenant list', async () => {
      // A 404 for a non-member caches the detail as null, and the tenant route's loader would hand that straight back.
      client.setQueryData(tenantKeys.detail('acme'), null)
      client.setQueryData(tenantKeys.invitations('acme'), [])
      client.setQueryData(tenantKeys.list, [])

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(client.getQueryState(tenantKeys.detail('acme'))).toBeUndefined()
      expect(client.getQueryState(tenantKeys.invitations('acme'))).toBeUndefined()
      expect(client.getQueryState(tenantKeys.list)?.isInvalidated).toBe(true)
    })

    it('refetches a cached tenant list that nothing is observing', async () => {
      // The accept page does not observe the list, and an invalidation alone refetches only active queries.
      let listCalls = 0
      const joined = [
        {
          tenant: { id: TENANT_ID, slug: 'acme' },
          role: 'editor',
          isPlatform: false,
          joinedAt: '2026-01-01T00:00:00.000Z',
        },
      ]
      server.use(
        http.get('/api/v1/tenants', () => {
          listCalls += 1
          return ok(listPage(listCalls === 1 ? [] : joined), 'Tenants retrieved.')
        })
      )
      // Loaded by a page that then unmounted, as when the reader visited /tenants before opening the link.
      const tenants = renderHook(() => useTenants(), { wrapper })
      await waitFor(() => expect(tenants.result.current.isSuccess).toBe(true))
      tenants.unmount()

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(listCalls).toBe(2)
      expect(client.getQueryData(tenantKeys.list)).toEqual(joined)
    })

    it('refetches a cached page of the Tenants list that nothing is observing', async () => {
      let pageCalls = 0
      server.use(
        http.get('/api/v1/tenants', () => {
          pageCalls += 1
          return ok(listPage([]), 'Tenants retrieved.')
        })
      )
      await client.fetchQuery(myTenantsListOptions({}))
      expect(pageCalls).toBe(1)

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(pageCalls).toBe(2)
    })

    it('refreshes the profile, so a role gained by accepting is live without a reload', async () => {
      server.use(
        http.get('/api/v1/profile', () => ok({ ...testUser, platformRole: 'viewer' }, 'Profile.'))
      )

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await waitFor(() => {
        expect(useAuthStore.getState().user?.platformRole).toBe('viewer')
      })
      expect(client.getQueryData(['profile'])).toEqual({ ...testUser, platformRole: 'viewer' })
    })

    it('leaves the cache alone when the server refuses', async () => {
      server.use(
        http.post('/api/v1/invitations/accept', () =>
          fail(
            'This invitation was sent to a different email address.',
            403,
            'invitation_email_mismatch'
          )
        )
      )
      client.setQueryData(tenantKeys.list, [])

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(client.getQueryState(tenantKeys.list)?.isInvalidated).toBe(false)
      // A 403 judges the invitation, not the session.
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })

  describe('inviterName', () => {
    it('joins the names, and falls back when there are none', () => {
      expect(inviterName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace')
      expect(inviterName({ firstName: 'Ada', lastName: null })).toBe('Ada')
      expect(inviterName({ firstName: null, lastName: null })).toBe('A teammate')
      expect(inviterName(null)).toBe('A teammate')
    })
  })

  describe('useAcceptInvitation alreadyMember', () => {
    it('reads alreadyMember from accept', async () => {
      server.use(
        http.post('/api/v1/invitations/accept', () =>
          ok(
            { tenant: { name: 'Acme Corp', slug: 'acme' }, role: 'editor', alreadyMember: true },
            'Invitation accepted.'
          )
        )
      )

      const { result } = renderHook(() => useAcceptInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data?.alreadyMember).toBe(true)
    })
  })

  describe('useVerifyInvitation', () => {
    it('signs in and refreshes the tenant list on a verified invitation', async () => {
      let body: unknown
      let authorization: string | null = 'unset'
      let profileCalls = 0
      server.use(
        http.post('/api/v1/invitations/verify', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok(
            {
              user: testUser,
              accessToken: 'invitation-token',
              isNewUser: true,
              tenant: { name: 'Acme Corp', slug: 'acme' },
              role: 'editor',
            },
            'Invitation accepted.'
          )
        }),
        http.get('/api/v1/profile', () => {
          profileCalls += 1
          return ok(testUser, 'Profile retrieved.')
        })
      )
      useAuthStore.setState({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isBootstrapped: true,
      })
      client.setQueryData(tenantKeys.detail('acme'), null)
      client.setQueryData(tenantKeys.list, [])
      let signedInAtTrack: boolean | undefined
      vi.mocked(track).mockImplementation(() => {
        signedInAtTrack = useAuthStore.getState().isAuthenticated
      })

      const { result } = renderHook(() => useVerifyInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: TEST_INVITATION_TOKEN })
      expect(authorization).toBeNull()
      expect(useAuthStore.getState().user).toEqual(testUser)
      expect(useAuthStore.getState().accessToken).toBe('invitation-token')
      expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'link' })
      expect(signedInAtTrack).toBe(true)
      expect(client.getQueryState(tenantKeys.detail('acme'))).toBeUndefined()
      expect(client.getQueryState(tenantKeys.list)?.isInvalidated).toBe(true)
      // The user arrived in the response, so the profile is not read again.
      expect(profileCalls).toBe(0)
    })

    it('does not retry a 401 or refresh the session', async () => {
      let calls = 0
      let refreshes = 0
      server.use(
        http.post('/api/v1/invitations/verify', () => {
          calls += 1
          return fail('Unauthorized', 401)
        }),
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useVerifyInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
      expect(refreshes).toBe(0)
    })

    it('drops a different user data, recents and shared identity, and tells other tabs', async () => {
      const other = { ...testUser, id: 'other-user-id', email: 'other@b.test' }
      useAuthStore.getState().login('other-token', other)
      client.setQueryData(['tenants', 'secret'], { owner: other.id })
      localStorage.setItem(`${RECENT_KEY_PREFIX}${other.id}`, '["x"]')
      const tab = new BroadcastChannel('auth')
      const received: unknown[] = []
      tab.addEventListener('message', (event: MessageEvent<unknown>) => {
        received.push(event.data)
      })

      const { result } = renderHook(() => useVerifyInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await vi.waitFor(() => expect(received).toContainEqual({ type: 'logout' }))
      tab.close()
      expect(client.getQueryData(['tenants', 'secret'])).toBeUndefined()
      expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${other.id}`)).toBeNull()
      expect(yieldSharedIdentity).toHaveBeenCalledOnce()
      expect(useAuthStore.getState().user).toEqual(testUser)
    })

    it('leaves the store signed out on a 404', async () => {
      server.use(
        http.post('/api/v1/invitations/verify', () =>
          fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
        )
      )
      useAuthStore.setState({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isBootstrapped: true,
      })

      const { result } = renderHook(() => useVerifyInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(track).not.toHaveBeenCalled()
    })

    it('sets no session, tracks nothing and switches no one out on a 202 "Check your inbox"', async () => {
      server.use(
        http.post('/api/v1/invitations/verify', () =>
          ok(
            { confirmationSent: true, email: 'ada@example.test' },
            'Check your inbox to finish joining.',
            202
          )
        )
      )
      const other = { ...testUser, id: 'other-user-id', email: 'other@b.test' }
      useAuthStore.getState().login('other-token', other)
      client.setQueryData(['tenants', 'secret'], { owner: other.id })
      client.setQueryData(tenantKeys.list, [])

      const { result } = renderHook(() => useVerifyInvitation(), { wrapper })
      result.current.mutate(TEST_INVITATION_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual({ confirmationSent: true, email: 'ada@example.test' })
      expect(useAuthStore.getState().user).toEqual(other)
      expect(useAuthStore.getState().accessToken).toBe('other-token')
      expect(client.getQueryData(['tenants', 'secret'])).toEqual({ owner: other.id })
      expect(client.getQueryState(tenantKeys.list)?.isInvalidated).toBe(false)
      expect(track).not.toHaveBeenCalled()
      expect(yieldSharedIdentity).not.toHaveBeenCalled()
    })
  })

  describe('useConfirmInvitation', () => {
    /** Records each confirm post's body and bearer header, answering `answer`. */
    function serveConfirm(answer: () => Response) {
      const seen: { body: unknown; authorization: string | null }[] = []
      server.use(
        http.post('/api/v1/invitations/confirm', async ({ request }) => {
          seen.push({
            body: await request.json(),
            authorization: request.headers.get('authorization'),
          })
          return answer()
        })
      )
      return seen
    }

    /** The confirm `200`: the verify shape, a session that joined the tenant. */
    const joined = () =>
      ok(
        {
          user: testUser,
          accessToken: 'confirm-token',
          isNewUser: false,
          tenant: { name: 'Acme Corp', slug: 'acme' },
          role: 'editor',
        },
        'Invitation accepted.'
      )

    it('posts the token and the trimmed address with no bearer, then signs in and refreshes the tenants', async () => {
      const seen = serveConfirm(joined)
      useAuthStore.setState({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isBootstrapped: true,
      })
      client.setQueryData(tenantKeys.detail('acme'), null)
      client.setQueryData(tenantKeys.list, [])
      let signedInAtTrack: boolean | undefined
      vi.mocked(track).mockImplementation(() => {
        signedInAtTrack = useAuthStore.getState().isAuthenticated
      })

      const { result } = renderHook(() => useConfirmInvitation(), { wrapper })
      result.current.mutate({ token: TEST_INVITATION_TOKEN, email: '  ada@example.test ' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(seen).toEqual([
        { body: { token: TEST_INVITATION_TOKEN, email: 'ada@example.test' }, authorization: null },
      ])
      expect(useAuthStore.getState().user).toEqual(testUser)
      expect(useAuthStore.getState().accessToken).toBe('confirm-token')
      expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'link' })
      expect(signedInAtTrack).toBe(true)
      expect(client.getQueryState(tenantKeys.detail('acme'))).toBeUndefined()
      expect(client.getQueryState(tenantKeys.list)?.isInvalidated).toBe(true)
    })

    it.each([
      ['no address', undefined],
      ['a blank address', '   '],
    ])('omits the address when the link has %s', async (_case, email) => {
      const seen = serveConfirm(joined)

      const { result } = renderHook(() => useConfirmInvitation(), { wrapper })
      result.current.mutate({ token: TEST_INVITATION_TOKEN, email })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(seen[0]?.body).toEqual({ token: TEST_INVITATION_TOKEN })
    })

    it('replaces a signed-in session with the one the link signed in', async () => {
      serveConfirm(joined)
      const other = { ...testUser, id: 'other-user-id', email: 'other@b.test' }
      useAuthStore.getState().login('other-token', other)
      client.setQueryData(['tenants', 'secret'], { owner: other.id })

      const { result } = renderHook(() => useConfirmInvitation(), { wrapper })
      result.current.mutate({ token: TEST_INVITATION_TOKEN, email: testUser.email })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(client.getQueryData(['tenants', 'secret'])).toBeUndefined()
      expect(useAuthStore.getState().user).toEqual(testUser)
    })

    it('does not retry a 401 or refresh the session', async () => {
      let refreshes = 0
      const seen = serveConfirm(() => fail('Unauthorized', 401))
      server.use(
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useConfirmInvitation(), { wrapper })
      result.current.mutate({ token: TEST_INVITATION_TOKEN, email: testUser.email })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(seen).toHaveLength(1)
      expect(refreshes).toBe(0)
    })

    it('leaves the store signed out on a 404', async () => {
      serveConfirm(() =>
        fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
      )
      useAuthStore.setState({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isBootstrapped: true,
      })

      const { result } = renderHook(() => useConfirmInvitation(), { wrapper })
      result.current.mutate({ token: TEST_INVITATION_TOKEN, email: testUser.email })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(track).not.toHaveBeenCalled()
    })
  })
})
