import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureSession, resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ACCESS_TOKEN_EXPIRED } from '@/types/api.types'

describe('ensureSession', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('refreshes then fetches the profile, because refresh returns no user', async () => {
    const token = await ensureSession()
    expect(token).toBe('fresh-token')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('fresh-token')
    expect(s.user).toEqual(testUser)
    expect(s.isAuthenticated).toBe(true)
  })

  it('issues exactly ONE refresh for N concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )

    const tokens = await Promise.all([ensureSession(), ensureSession(), ensureSession()])

    expect(refreshCount).toBe(1)
    expect(tokens).toEqual(['fresh-token', 'fresh-token', 'fresh-token'])
  })

  it('logs out and rejects when the refresh fails', async () => {
    useAuthStore.getState().login('stale', testUser)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))

    await expect(ensureSession()).rejects.toThrow()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  it('allows a new refresh after the previous one settled', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return ok({ accessToken: `token-${refreshCount}` }, 'Token refreshed.')
      })
    )

    await ensureSession()
    await ensureSession()

    expect(refreshCount).toBe(2)
  })
  // Regression: the profile fetch inside refreshSession() must carry the FRESH
  // token. If the request interceptor overwrites it with the stale token still
  // in the store, /profile 401s with ACCESS_TOKEN_EXPIRED, the response
  // interceptor calls ensureSession(), and that returns the very promise that
  // is awaiting this profile request — a permanent self-wait, not an error.
  it('does not deadlock when a stale token is still in the store', async () => {
    useAuthStore.getState().login('stale', testUser)
    server.use(
      http.get('/api/v1/profile', ({ request }) =>
        request.headers.get('authorization') === 'Bearer fresh-token'
          ? ok(testUser, 'Profile retrieved.')
          : fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED)
      )
    )

    await expect(ensureSession()).resolves.toBe('fresh-token')
    expect(useAuthStore.getState().user).toEqual(testUser)
  })
  // The single-flight promise must clear itself on REJECTION too, not only on
  // success. `.then()` in place of `.finally()` passes every other test in
  // this file — they each call resetSessionForTests() first — while leaking
  // the rejected promise and wedging the session permanently. Deliberately no
  // resetSessionForTests() between the two halves: that is the whole point.
  it('allows a new refresh after the previous one REJECTED', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return refreshCount === 1
          ? fail('Unauthorized', 401)
          : ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )

    await expect(ensureSession()).rejects.toThrow()
    await expect(ensureSession()).resolves.toBe('fresh-token')

    expect(refreshCount).toBe(2)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  // /profile is behind requireAuth and the backend's auth middleware emits
  // ACCESS_TOKEN_EXPIRED, so a fresh token judged expired — clock skew, a
  // near-zero TTL, a key-rotation race — lands here. Without `skipAuthRetry`
  // the response interceptor calls ensureSession() and awaits the promise
  // awaiting this very request: no rejection, no logout, no redirect, just a
  // wedged session. The short timeout makes a regression fail red in 2s
  // instead of hanging the run.
  it('rejects rather than hanging when its own profile call 401s as expired', async () => {
    useAuthStore.getState().login('stale', testUser)
    server.use(
      http.get('/api/v1/profile', () => fail('Access token expired', 401, ACCESS_TOKEN_EXPIRED))
    )

    await expect(ensureSession()).rejects.toThrow()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  }, 2000)
})
