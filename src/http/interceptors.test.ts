import axios from 'axios'
import { http } from 'msw'
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
