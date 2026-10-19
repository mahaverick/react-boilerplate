import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import { resetSessionForTests } from '@/http/session'
import { track, yieldSharedIdentity } from '@/observability/telemetry'
import { useRequestSignInLink, useVerifySignInLink } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
  yieldSharedIdentity: vi.fn(),
}))

const LINK_TOKEN = 't'.repeat(43)

describe('sign-in link queries', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    resetSessionForTests()
    vi.mocked(track).mockReset()
    vi.mocked(yieldSharedIdentity).mockReset()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
  })

  describe('useRequestSignInLink', () => {
    it('does not retry a 401 or refresh the session', async () => {
      let calls = 0
      let refreshes = 0
      server.use(
        http.post('/api/v1/auth/link/request', () => {
          calls += 1
          return fail('Unauthorized', 401)
        }),
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
      expect(refreshes).toBe(0)
    })

    it('requests a link for the web app with no bearer', async () => {
      let body: unknown
      let authorization: string | null = 'unset'
      server.use(
        http.post('/api/v1/auth/link/request', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok(null, 'Check your inbox for a sign-in link.', 202)
        })
      )
      // A signed-in tab must not send its bearer either.
      useAuthStore.getState().login('access-token', testUser)

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ email: 'a@b.test', app: 'web' })
      expect(authorization).toBeNull()
      expect(track).toHaveBeenCalledWith('sign_in_link_requested')
    })

    it('sends the redirect when one is given', async () => {
      let body: unknown
      server.use(
        http.post('/api/v1/auth/link/request', async ({ request }) => {
          body = await request.json()
          return ok(null, 'Check your inbox for a sign-in link.', 202)
        })
      )

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper })
      result.current.mutate({ email: 'a@b.test', redirect: '/tenants/acme' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ email: 'a@b.test', app: 'web', redirect: '/tenants/acme' })
    })

    it('tracks nothing when the request fails', async () => {
      server.use(http.post('/api/v1/auth/link/request', () => fail('Too many requests.', 429)))

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(track).not.toHaveBeenCalled()
    })
  })

  describe('useVerifySignInLink', () => {
    it('signs the store in on a verified link and tracks sign_in_completed after it', async () => {
      let body: unknown
      let authorization: string | null = 'unset'
      server.use(
        http.post('/api/v1/auth/link/verify', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok(
            { user: testUser, accessToken: 'link-token', isNewUser: true, redirect: '/dashboard' },
            'Signed in.'
          )
        })
      )
      let signedInAtTrack: boolean | undefined
      vi.mocked(track).mockImplementation(() => {
        signedInAtTrack = useAuthStore.getState().isAuthenticated
      })

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: LINK_TOKEN })
      expect(authorization).toBeNull()
      expect(result.current.data).toEqual({
        user: testUser,
        accessToken: 'link-token',
        isNewUser: true,
        redirect: '/dashboard',
      })
      expect(useAuthStore.getState().user).toEqual(testUser)
      expect(useAuthStore.getState().accessToken).toBe('link-token')
      expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'link' })
      expect(signedInAtTrack).toBe(true)
    })

    it('does not retry a 401 or refresh the session', async () => {
      let calls = 0
      let refreshes = 0
      server.use(
        http.post('/api/v1/auth/link/verify', () => {
          calls += 1
          return fail('Unauthorized', 401)
        }),
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
      expect(refreshes).toBe(0)
    })

    it("sends the link's address with the token, so the server can refuse a mismatch", async () => {
      let body: unknown
      server.use(
        http.post('/api/v1/auth/link/verify', async ({ request }) => {
          body = await request.json()
          return ok(
            { user: testUser, accessToken: 'link-token', isNewUser: false, redirect: null },
            'Signed in.'
          )
        })
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN, email: testUser.email })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: LINK_TOKEN, email: testUser.email })
    })

    it.each(['', '   '])('leaves out an address of %j', async (email) => {
      let body: unknown
      server.use(
        http.post('/api/v1/auth/link/verify', async ({ request }) => {
          body = await request.json()
          return ok(
            { user: testUser, accessToken: 'link-token', isNewUser: false, redirect: null },
            'Signed in.'
          )
        })
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN, email })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: LINK_TOKEN })
    })

    it('leaves the store signed out on a 400 LINK_INVALID', async () => {
      server.use(
        http.post('/api/v1/auth/link/verify', () =>
          fail('This link has expired or was already used.', 400, 'LINK_INVALID')
        )
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(track).not.toHaveBeenCalled()
    })
  })

  describe('a different user already signed in', () => {
    const OTHER_USER = { ...testUser, id: 'other-user-id', email: 'other@b.test' }

    /** Signs `OTHER_USER` in with cached data and a recents list, and opens a channel standing in for another tab. */
    function signInOtherUser() {
      useAuthStore.getState().login('other-token', OTHER_USER)
      client.setQueryData(['tenants', 'secret'], { owner: OTHER_USER.id })
      localStorage.setItem(`${RECENT_KEY_PREFIX}${OTHER_USER.id}`, '["x"]')
      const tab = new BroadcastChannel('auth')
      const received: unknown[] = []
      tab.addEventListener('message', (event: MessageEvent<unknown>) => {
        received.push(event.data)
      })
      return { tab, received }
    }

    it('drops the previous user data, recents and shared identity, and tells other tabs', async () => {
      const { tab, received } = signInOtherUser()

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await vi.waitFor(() => expect(received).toContainEqual({ type: 'logout' }))
      tab.close()
      expect(client.getQueryData(['tenants', 'secret'])).toBeUndefined()
      expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${OTHER_USER.id}`)).toBeNull()
      expect(yieldSharedIdentity).toHaveBeenCalledOnce()
      expect(useAuthStore.getState().user).toEqual(testUser)
    })

    it('keeps the cache and sends no broadcast for the same user', async () => {
      useAuthStore.getState().login('old-token', testUser)
      client.setQueryData(['tenants', 'mine'], { ok: true })
      const tab = new BroadcastChannel('auth')
      const received: unknown[] = []
      tab.addEventListener('message', (event: MessageEvent<unknown>) => {
        received.push(event.data)
      })

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate({ token: LINK_TOKEN })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await settle(0, 'absence has no event: let any queued channel delivery run')
      tab.close()
      expect(received).toEqual([])
      expect(client.getQueryData(['tenants', 'mine'])).toEqual({ ok: true })
      expect(yieldSharedIdentity).not.toHaveBeenCalled()
    })
  })
})
