import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/constants/routes'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { NON_VERDICT_FAILURES } from '@/tests/fixtures/non-verdict-failures'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ACCESS_TOKEN_EXPIRED, type ApiSuccess } from '@/types/api.types'

/**
 * Handlers below that 401 unconditionally stop after this many attempts. If
 * `_retried` ever regresses, the retry loop is unbounded: the reviewer's run
 * hit 400+ attempts and had to be killed. Capping the HANDLER turns that into
 * a fast assertion failure instead of a wedged CI worker.
 */
const RETRY_CAP = 5

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
   * jsdom's window.location is unforgeable, so assign() cannot be spied on.
   *
   * `pathname`/`search`/`hash` are set EXPLICITLY rather than left to the
   * spread: they are prototype accessors on jsdom's Location, so `{...}`
   * copies none of them — which is why `href` was already being restated
   * here. `redirectToLogin` reads all three to build `?redirect=`, and a
   * spread-only stub would have it encode `undefined`.
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
    // That 401 is now a verdict, which navigates; keep jsdom's navigation stub quiet.
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
  // The forced logout carries the caller's whole location, query and all:
  // `_app`'s guard already writes `?redirect=` on the navigations it blocks
  // and login.tsx already consumes it, so a forced logout that dropped it
  // would be the one door into /login that forgets where the user was.
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
    // Refresh's own 401 (skipAuthRetry) is not re-judged or retried: exactly one call.
    expect(refreshCalls).toBe(1)
  })

  // Without this guard /login becomes its own redirect target, and signing in
  // "returns" the user to the page they just signed in on.
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

  // The mirror of the test above, and the reason session.ts no longer logs
  // out unconditionally: when the refresh could not REACH the API, the
  // session was never judged, so the store still holds it — and navigating to
  // /login here would throw the user out of a session that is still valid,
  // undoing that fix from the other side.
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

  // The redirect follows the same rule as the logout, and has to: a session
  // left intact by session.ts but bounced to /login from here is signed out
  // just the same, only through a different door.
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

  // The replay is outside the refresh try/catch on purpose: a retried request
  // that fails on its own merits must not bounce a still-valid session.
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

  // A 401 without ACCESS_TOKEN_EXPIRED, on a request that carried a token, is
  // the server judging that token: revoked, deactivated, or simply invalid.
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

  // The login form's 401 judges a password, not a session: no token was sent.
  it("leaves an unauthenticated request's 401 alone, like the login form's", async () => {
    const assign = stubLocation(ROUTES.login)
    let seen: string | null = 'unset'
    server.use(
      http.post('/api/v1/auth/login', ({ request }) => {
        seen = request.headers.get('authorization')
        return fail('Invalid email or password', 401)
      })
    )

    await expect(
      makeClient().post('/auth/login', { email: 'a@b.com', password: 'wrong' })
    ).rejects.toMatchObject({ response: { status: 401 } })
    expect(seen).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  // refreshSession()'s own calls carry skipAuthRetry, and the stale token too.
  // Judging them here would redirect from inside bootstrap and double-handle the 401.
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
    server.use(http.get('/api/v1/widgets', () => fail('Insufficient permissions', 403)))

    await expect(makeClient().get('/widgets')).rejects.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })
})
