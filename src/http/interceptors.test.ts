import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/constants/routes'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
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

/**
 * Every way `/auth/refresh` can fail WITHOUT judging the caller's
 * credentials. None of these may end a session.
 *
 * - 503: nginx through a rolling restart. The SSE stream errors, the hook
 *   reconnects through ensureSession(), and a logout here would sign out
 *   every user with a tab open on every deploy.
 * - 429: /auth/refresh is rate limited, and the hook calls ensureSession()
 *   on a schedule across every open tab — so a flapping network can
 *   manufacture the 429 that would then end the session.
 * - A 200 carrying HTML: rejectMalformedJsonResponse throws an AxiosError
 *   that CARRIES a response, so a poisoned cache entry looked exactly like
 *   an auth verdict under the old `response !== undefined` test.
 */
const NON_VERDICT_FAILURES: [string, () => Response][] = [
  ['a 503 from a restarting upstream', () => fail('Service Unavailable', 503)],
  ['a 429 from the refresh rate limiter', () => fail('Too Many Requests', 429)],
  [
    'a malformed 200 carrying HTML',
    () =>
      new HttpResponse('<!doctype html><title>nope</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  ],
]

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

  /** jsdom's window.location is unforgeable, so assign() cannot be spied on. */
  function stubLocation() {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, href: window.location.href, assign })
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
  it('redirects to the login page when the refresh itself fails', async () => {
    useAuthStore.getState().login('stale', testUser)
    const assign = stubLocation()
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
    expect(useAuthStore.getState().accessToken).toBeNull()
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
})
