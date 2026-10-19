import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { track } from '@/observability/telemetry'
import { Route as callback } from '@/pages/auth/callback'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

/** Mounts the real route tree at `path`, under StrictMode as dev runs it, and returns the router. */
function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>
  )
  return router as AnyRouter
}

/** The API just set the refresh cookie, so the root's bootstrap restores a session. */
function arriveSignedIn() {
  server.use(
    http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
    http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
  )
}

const ACME = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** The visitor owns one tenant, so a landing with no redirect is the dashboard. */
function serveOneTenant() {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          { tenant: ACME, role: 'owner', isPlatform: false, joinedAt: '2026-01-01T00:00:00.000Z' },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.'))
  )
}

/** Google refused, or the cookie never arrived: the bootstrap settles signed out. */
function arriveSignedOut() {
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  vi.mocked(track).mockReset()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
})

describe('/auth/callback', () => {
  it('lands a new Google user on /welcome', async () => {
    arriveSignedIn()
    const router = renderAt(`/auth/callback?redirect=${encodeURIComponent('/notifications')}&new=1`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/welcome')
    })
  })

  it("accepts new as the router's number 1 and as the string '1', nothing else", () => {
    const schema = callback.options.validateSearch as unknown as {
      parse: (input: unknown) => { new?: unknown }
    }
    /** The parsed `new` for a raw search object. */
    const validate = (input: unknown) => schema.parse(input)
    expect(validate({ new: 1 }).new).toBe(1)
    expect(validate({ new: '1' }).new).toBe('1')
    expect(validate({ new: 2 }).new).toBeUndefined()
    expect(validate({ new: 'yes' }).new).toBeUndefined()
    expect(validate({}).new).toBeUndefined()
  })

  it('lands a returning user on the safe redirect', async () => {
    arriveSignedIn()
    const router = renderAt(
      `/auth/callback?redirect=${encodeURIComponent('/notifications?tab=unread')}`
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/notifications')
    })
    expect(router.state.location.searchStr).toContain('tab=unread')
  })

  it('lands a returning user with a tenant and no redirect on the dashboard', async () => {
    arriveSignedIn()
    serveOneTenant()
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })

  it('lands a returning user with no tenant and no redirect on /welcome', async () => {
    arriveSignedIn()
    let reads = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        reads += 1
        return ok(listPage([]), 'Tenants retrieved.')
      })
    )
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/welcome')
    })
    expect(reads).toBeGreaterThan(0)
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('lands on the dashboard when the tenant list cannot be read', async () => {
    arriveSignedIn()
    server.use(http.get('/api/v1/tenants', () => fail('Internal error', 500)))
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)'])(
    'lands an unsafe callback redirect on the dashboard (%s)',
    async (unsafe) => {
      arriveSignedIn()
      serveOneTenant()
      const router = renderAt(`/auth/callback?redirect=${encodeURIComponent(unsafe)}`)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
      expect(router.state.location.href).not.toContain('evil')
    }
  )

  it('replaces the callback in history, so Back never returns to it', async () => {
    arriveSignedIn()
    serveOneTenant()
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('tracks sign_in_completed with method google, once under StrictMode', async () => {
    arriveSignedIn()
    const router = renderAt('/auth/callback?new=1')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/welcome')
    })
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'sign_in_completed')).toEqual([
      ['sign_in_completed', { method: 'google' }],
    ])
  })

  it('sends a signed-out callback to /login with google_auth_failed', async () => {
    arriveSignedOut()
    const router = renderAt('/auth/callback?new=1')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toEqual({ error: 'google_auth_failed' })
    expect(track).not.toHaveBeenCalledWith('sign_in_completed', expect.anything())
  })
})
