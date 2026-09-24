import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import {
  invitationKeys,
  inviterName,
  useAcceptInvitation,
  useInvitationPreview,
} from '@/queries/invitation.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import {
  fail,
  ok,
  TEST_INVITATION_TOKEN,
  testInvitationPreview,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('invitation queries', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    // `retry: 1` like the router's client, with no delay, so the preview's
    // own retry rule is what decides.
    client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    resetSessionForTests()
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
      // Never in the URL, where logs and history would keep it.
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
      // A 404 from before the caller was a member caches the detail as null,
      // and the tenant route's loader would hand that straight back.
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
      // A 403 is not a session verdict.
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
})
