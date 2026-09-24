import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { bootstrapSession, queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('session bootstrap', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('restores a session from the refresh cookie', async () => {
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isBootstrapped).toBe(true)
  })

  it('settles as signed-out when there is no valid cookie', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    // The critical assertion: bootstrapped must be TRUE even on failure, or
    // a guard waiting on it would hang forever instead of redirecting.
    expect(s.isBootstrapped).toBe(true)
  })

  it('runs the refresh only once across concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return HttpResponseOk()
      })
    )
    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()])
    expect(refreshCount).toBe(1)
  })

  it('listens for another tab signing out once the session is restored', async () => {
    await bootstrapSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    const assign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: `${window.location.origin}/dashboard`,
      pathname: '/dashboard',
      search: '',
      hash: '',
      assign,
    })
    const otherTab = new BroadcastChannel('auth')

    try {
      otherTab.postMessage({ type: 'logout' })
      await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
      expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/dashboard')}`)
    } finally {
      otherTab.close()
      vi.unstubAllGlobals()
    }
  })
})

function HttpResponseOk() {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Token refreshed.',
      statusCode: 200,
      data: { accessToken: 'fresh-token' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * The guards themselves, driven through a real RouterProvider.
 *
 * The bootstrap tests above prove `bootstrapSession()` settles correctly. They
 * do NOT prove the guards wait for it, which is the whole point of putting the
 * await in __root's beforeLoad rather than a useEffect. These do.
 *
 * Every refresh handler here is DELAYED. That is what makes the tests
 * load-bearing: if a guard ran before the session settled it would observe an
 * empty store, and the signed-in case below would leave the user sitting on
 * /login instead of moving them to /dashboard.
 */
describe('route guards', () => {
  let snapshots: { isAuthenticated: boolean; isBootstrapped: boolean }[] = []
  let getState: typeof useAuthStore.getState

  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    // Record what the store looked like on every read. The LAST read of a
    // navigation is always a guard's — bootstrapSession() runs first and the
    // guards run after it — so asserting on it proves no guard observed a
    // half-restored store.
    snapshots = []
    getState = useAuthStore.getState.bind(useAuthStore)
    vi.spyOn(useAuthStore, 'getState').mockImplementation(() => {
      const state = getState()
      snapshots.push({
        isAuthenticated: state.isAuthenticated,
        isBootstrapped: state.isBootstrapped,
      })
      return state
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderAt(path: string): AnyRouter {
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(<RouterProvider router={router as never} />)
    return router as AnyRouter
  }

  /** The guard that ran last must have seen a settled store. */
  function expectGuardSawSettledStore() {
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.at(-1)?.isBootstrapped).toBe(true)
  }

  it('sends a signed-out visitor from /dashboard to /login, preserving where they were going', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return fail('Unauthorized', 401)
      })
    )
    const router = renderAt('/dashboard')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    // Asserted by VALUE, not merely by presence. Nothing consumes this param
    // until Task 5's login page, so this assertion is the only thing holding
    // it in place.
    expect(router.state.location.search).toEqual({ redirect: '/dashboard' })
    expectGuardSawSettledStore()
  })

  it('sends a signed-in visitor from /login to /dashboard', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
    )
    const router = renderAt('/login')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expectGuardSawSettledStore()
  })

  it('sends a signed-out visitor from / to /login', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return fail('Unauthorized', 401)
      })
    )
    const router = renderAt('/')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expectGuardSawSettledStore()
  })
})

/**
 * `/reset-password` and `/verify-email` are TOP-LEVEL file routes, deliberately
 * outside `_auth`.
 *
 * Under `_auth` its guard would send an authenticated visitor to /dashboard —
 * so a user already signed in on this browser who clicks the link in their
 * inbox would be bounced and the token never consumed. Moving them under
 * `/auth/` would have been the tidy fix and the wrong one: the backend builds
 * these links as `${WEB_URL}/reset-password?token=` and
 * `${WEB_URL}/verify-email?token=` with no prefix, so the paths must not move.
 * These tests hold both halves in place — no guard, and the same URLs.
 */
describe('token routes outside the auth guard', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    // A valid cookie: this visitor IS signed in, which is the whole point.
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
    )
  })

  function renderAt(path: string): AnyRouter {
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )
    return router as AnyRouter
  }

  it('lets a signed-in visitor open a reset link instead of bouncing them', async () => {
    const router = renderAt('/reset-password?token=reset-token')

    expect(await screen.findByText('Choose a new password')).toBeInTheDocument()
    // Vacuous unless they really are signed in — that is the case `_auth`
    // would have redirected.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(router.state.location.pathname).toBe('/reset-password')
  })

  it('lets a signed-in visitor open a verification link instead of bouncing them', async () => {
    const router = renderAt('/verify-email?token=verify-token')

    expect(await screen.findByText('Verify your email')).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(router.state.location.pathname).toBe('/verify-email')
  })
})
