import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { track } from '@/observability/telemetry'
import { useRequestSignInLink, useVerifySignInLink } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
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
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
  })

  describe('useRequestSignInLink', () => {
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
      result.current.mutate(LINK_TOKEN)

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

    it('leaves the store signed out on a 400 LINK_INVALID', async () => {
      server.use(
        http.post('/api/v1/auth/link/verify', () =>
          fail('This link has expired or was already used.', 400, 'LINK_INVALID')
        )
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(track).not.toHaveBeenCalled()
    })
  })
})
