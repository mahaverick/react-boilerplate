import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/constants/routes'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests, SessionIdentityChangedError } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID_2 } from '@/tests/fixtures/ids'
import { NON_VERDICT_FAILURES } from '@/tests/fixtures/non-verdict-failures'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ACCESS_TOKEN_EXPIRED, REAUTH_REQUIRED, type ApiSuccess } from '@/types/api.types'

/**
 * Handlers below that 401 unconditionally stop after this many attempts. If `_retried`
 * regressed, the retry loop would be unbounded; capping the handler turns that into a fast
 * assertion failure instead of a wedged CI worker.
 */
const RETRY_CAP = 5

/** An axios client with the production interceptors installed, so each test drives them directly. */
function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

describe('auth interceptors', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  /**
   * Replaces `window.location` with a stub and returns its `assign` spy; jsdom's own
   * `assign` cannot be spied on. `href`, `pathname`, `search` and `hash` are set to the
   * test's URL because `redirectToLogin` reads them to build `?redirect=`.
   */
  function stubLocation(pathname = '/widgets', search = '', hash = '') {
    const assign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: `${window.location.origin}${pathname}${search}${hash}`,
      pathname,
      search,
      hash,
      assign,
    })
    return assign
  }

  it('attaches the bearer token when one is present', async () => {
    useAuthStore.getState().login('tok', testUser)
    let seen: string | null = null
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        seen = request.headers.get('authorization')
        return ok([])
      })
    )

    await makeClient().get('/widgets')
    expect(seen).toBe('Bearer tok')
  })

  it('sends no auth header when there is no token', async () => {
    let seen: string | null = 'unset'
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        seen = request.headers.get('authorization')
        return ok([])
      })
    )

    await makeClient().get('/widgets')
    expect(seen).toBeNull()
  })

  it('refreshes and replays once on ACCESS_TOKEN_EXPIRED', async () => {
    useAuthStore.getState().login('stale', testUser)
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', ({ request }) => {
        attempts += 1
        if (request.headers.get('authorization') === 'Bearer stale') {
          return fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
        }
        return ok(['widget'])
      })
    )

    const response = await makeClient().get<ApiSuccess<string[]>>('/widgets')
    expect(attempts).toBe(2)
    expect(response.data.data).toEqual(['widget'])
    expect(useAuthStore.getState().accessToken).toBe('fresh-token')
  })

  it('refresh returning a different user signs out and does not replay', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation('/widgets')
    let attempts = 0
    server.use(
      http.get('/api/v1/profile', () =>
        ok({ ...testUser, id: USER_ID_2, email: 'b@b.com' }, 'Profile retrieved.')
      ),
      http.post('/api/v1/widgets', () => {
        attempts += 1
        return fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().post('/widgets', { name: 'A’s widget' })).rejects.toBeInstanceOf(
      SessionIdentityChangedError
    )
    expect(attempts).toBe(1)
    expect(useAuthStore.getState().user).toBeNull()
    expect(assign).toHaveBeenCalledWith(
      `${ROUTES.login}?redirect=${encodeURIComponent('/widgets')}`
    )
  })

  it('fires ONE refresh for several concurrent expired requests', async () => {
    useAuthStore.getState().login('stale', testUser)
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/widgets', ({ request }) =>
        request.headers.get('authorization') === 'Bearer stale'
          ? fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
          : ok(['widget'])
      )
    )

    const client = makeClient()
    await Promise.all([client.get('/widgets'), client.get('/widgets'), client.get('/widgets')])

    expect(refreshCount).toBe(1)
  })

  it('does not retry a 401 that lacks the expiry code', async () => {
    useAuthStore.getState().login('tok', testUser)
    // This 401 is a verdict and navigates, so stub the navigation.
    stubLocation()
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return fail('Forbidden', 401)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(attempts).toBe(1)
  })

  it('never retries the same request twice', async () => {
    useAuthStore.getState().login('stale', testUser)
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(attempts).toBe(2)
  })
  /**
   * The forced logout carries the caller's whole location, query included: `_app`'s guard
   * writes `?redirect=` on the navigations it blocks and login.tsx consumes it, so a forced
   * logout that dropped it would be the one way into /login that forgets where the user was.
   */
  it('redirects to the login page, preserving the location, when the refresh fails', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation('/tenants/acme/members', '?page=2', '#roles')
    let attempts = 0
    let refreshCalls = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCalls += 1
        return fail('Unauthorized', 401)
      }),
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(assign).toHaveBeenCalledWith(
      `${ROUTES.login}?redirect=${encodeURIComponent('/tenants/acme/members?page=2#roles')}`
    )
    expect(useAuthStore.getState().accessToken).toBeNull()
    // The refresh's own 401 (skipAuthRetry) is neither judged again nor retried, so exactly one call.
    expect(refreshCalls).toBe(1)
  })

  // Without this guard /login becomes its own redirect target, and signing in "returns" the user to the page they just signed in on.
  it('writes no redirect param when the forced logout happens on /login itself', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation(ROUTES.login)
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)),
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(assign).toHaveBeenCalledWith(ROUTES.login)
  })

  /**
   * The mirror of the test above: when the refresh cannot reach the API the session was
   * never judged, so redirecting to /login would throw the user out of a valid session.
   */
  it('does not redirect when the refresh could not reach the API', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation()
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => HttpResponse.error()),
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(assign).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe('live-token')
  })

  // The redirect follows the same rule as the logout: a session session.ts leaves intact but this bounces to /login is signed out just the same.
  it.each(NON_VERDICT_FAILURES)('does not redirect on %s', async (_label, respond) => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation()
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => respond()),
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(assign).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe('live-token')
  })

  // The replay sits outside the refresh try/catch, so a retried request that fails on its own merits does not bounce a valid session.
  it('does not redirect when the refresh worked but the replay failed', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation()
    let attempts = 0
    server.use(
      http.get('/api/v1/widgets', () => {
        attempts += 1
        return attempts > RETRY_CAP
          ? ok(['widget'])
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      })
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(attempts).toBe(2)
    expect(assign).not.toHaveBeenCalled()
    expect(useAuthStore.getState().accessToken).toBe('fresh-token')
  })

  // A 401 without ACCESS_TOKEN_EXPIRED on a request that carried a token is the server judging that token: revoked, deactivated or invalid.
  it('logs out and redirects on a plain 401 (no code) to an authenticated request', async () => {
    useAuthStore.getState().login('tok', testUser)
    const assign = stubLocation('/tenants', '?page=2')
    server.use(
      http.get('/api/v1/widgets', () => fail('Account no longer exists or is inactive', 401))
    )

    await expect(makeClient().get('/widgets')).rejects.toMatchObject({
      response: { status: 401 },
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(assign).toHaveBeenCalledWith(
      `${ROUTES.login}?redirect=${encodeURIComponent('/tenants?page=2')}`
    )
  })

  it('ends the session when the REPLAY after a refresh is judged', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation()
    server.use(
      http.get('/api/v1/widgets', ({ request }) =>
        request.headers.get('authorization') === 'Bearer stale'
          ? fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
          : fail('Account no longer exists or is inactive', 401)
      )
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(assign).toHaveBeenCalledWith(
      `${ROUTES.login}?redirect=${encodeURIComponent('/widgets')}`
    )
  })

  // A request with no token judged that request, not a session.
  it('does not sign out on a 401 to a request that carried no token', async () => {
    const assign = stubLocation(ROUTES.login)
    let seen: string | null = 'unset'
    server.use(
      http.post('/api/v1/example', ({ request }) => {
        seen = request.headers.get('authorization')
        return fail('Unauthorized', 401)
      })
    )

    await expect(makeClient().post('/example', {})).rejects.toMatchObject({
      response: { status: 401 },
    })
    expect(seen).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  // refreshSession()'s own calls carry skipAuthRetry and the stale token; judging them here would redirect from inside bootstrap and handle the 401 twice.
  it('does not judge a 401 on a skipAuthRetry request, even with a token attached', async () => {
    useAuthStore.getState().login('tok', testUser)
    const assign = stubLocation()
    let refreshCalls = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCalls += 1
        return fail('Missing refresh token', 401)
      })
    )

    await expect(
      makeClient().post('/auth/refresh', undefined, { skipAuthRetry: true })
    ).rejects.toMatchObject({ response: { status: 401 } })
    expect(refreshCalls).toBe(1)
    expect(assign).not.toHaveBeenCalled()
    expect(useAuthStore.getState().accessToken).toBe('tok')
  })

  it('does not end the session on a 403', async () => {
    useAuthStore.getState().login('tok', testUser)
    const assign = stubLocation()
    server.use(
      http.get('/api/v1/widgets', () =>
        fail("Your role in this workspace doesn't allow this. Ask a workspace owner or admin.", 403)
      )
    )

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })

  it('tells other tabs when a 401 verdict ends the session', async () => {
    useAuthStore.getState().login('tok', testUser)
    stubLocation()
    const otherTab = new BroadcastChannel('auth')
    const received: unknown[] = []
    otherTab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    server.use(http.get('/api/v1/widgets', () => fail('Invalid access token', 401)))

    try {
      await expect(makeClient().get('/widgets')).rejects.toThrow()
      await vi.waitFor(() => expect(received).toEqual([{ type: 'logout' }]))
    } finally {
      otherTab.close()
    }
  })

  it('rejects a REAUTH_REQUIRED 401 plainly: no refresh, no sign-out, no navigation', async () => {
    useAuthStore.getState().login('tok', testUser)
    const assign = stubLocation()
    let refreshes = 0
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.post('/api/v1/widgets', () => {
        attempts += 1
        return fail('Recent sign-in required', 401, REAUTH_REQUIRED)
      })
    )
    const channel = new BroadcastChannel('auth')
    const broadcasts: unknown[] = []
    channel.addEventListener('message', (event: MessageEvent<unknown>) =>
      broadcasts.push(event.data)
    )

    try {
      const error: unknown = await makeClient()
        .post('/widgets', {})
        .catch((caught: unknown) => caught)

      expect(axios.isAxiosError(error) && error.response?.data).toMatchObject({
        code: REAUTH_REQUIRED,
      })
      expect(attempts).toBe(1)
      expect(refreshes).toBe(0)
      expect(useAuthStore.getState()).toMatchObject({ accessToken: 'tok', isAuthenticated: true })
      expect(assign).not.toHaveBeenCalled()
      await settle(0, 'a BroadcastChannel logout is a task away and has no event to await')
      expect(broadcasts).toEqual([])
    } finally {
      channel.close()
    }
  })
})
