import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/constants/routes'
import {
  broadcastLogout,
  ensureSession,
  installAuthBroadcastListener,
  resetSessionForTests,
} from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { NON_VERDICT_FAILURES } from '@/tests/fixtures/non-verdict-failures'
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

  // A 401 is a VERDICT: the refresh cookie is dead, so clearing the session
  // is the only correct answer. A transport failure is not a verdict about
  // anything — the session may be perfectly good and this call simply could
  // not ask. Signing the user out on it means a few seconds of downtime ends
  // a working session, which useNotificationStream turns into a routine
  // occurrence because it reconnects through ensureSession().
  it('rejects WITHOUT logging out when the API cannot be reached', async () => {
    useAuthStore.getState().login('live-token', testUser)
    server.use(http.post('/api/v1/auth/refresh', () => HttpResponse.error()))

    await expect(ensureSession()).rejects.toThrow()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.accessToken).toBe('live-token')
    expect(s.user).toEqual(testUser)
  })

  // The predicate is "the server JUDGED the credentials", not "the server
  // answered". These three all answer, and none of them is a judgment.
  it.each(NON_VERDICT_FAILURES)('rejects WITHOUT logging out on %s', async (_label, respond) => {
    useAuthStore.getState().login('live-token', testUser)
    server.use(http.post('/api/v1/auth/refresh', () => respond()))

    await expect(ensureSession()).rejects.toThrow()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.accessToken).toBe('live-token')
    expect(s.user).toEqual(testUser)
  })

  it('leaves the session intact when the PROFILE call cannot be reached', async () => {
    useAuthStore.getState().login('live-token', testUser)
    server.use(http.get('/api/v1/profile', () => HttpResponse.error()))

    await expect(ensureSession()).rejects.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  // The rejected attempt must not wedge the next one: the SSE reconnect path
  // depends on simply trying again once the API is back.
  it('succeeds on the next attempt once the API returns', async () => {
    useAuthStore.getState().login('live-token', testUser)
    let attempts = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.error()
          : ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )

    await expect(ensureSession()).rejects.toThrow()
    await expect(ensureSession()).resolves.toBe('fresh-token')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
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

/**
 * A minimal LockManager: one queue per name, each callback starting only after
 * the previous holder settled. That is the part of the Web Locks API
 * ensureSession relies on; jsdom ships none.
 */
function stubLocks(): string[] {
  const requested: string[] = []
  const tails = new Map<string, Promise<unknown>>()
  const locks = {
    request(name: string, callback: () => Promise<string>): Promise<string> {
      requested.push(name)
      const result = (tails.get(name) ?? Promise.resolve()).then(callback)
      tails.set(
        name,
        result.catch(() => undefined)
      )
      return result
    },
  }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return requested
}

/** jsdom's Location accessors live on the prototype, so a spread copies none of them. */
function stubLocation(pathname = '/dashboard', search = '', hash = '') {
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

describe('across tabs', () => {
  /** Channels standing in for OTHER tabs; this tab's own channel is session.ts's. */
  let otherTabs: BroadcastChannel[] = []

  function openOtherTab() {
    const tab = new BroadcastChannel('auth')
    const received: unknown[] = []
    tab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    otherTabs.push(tab)
    return { tab, received }
  }

  /** Lets every already-queued channel delivery run before a negative assertion. */
  async function flushDeliveries(probe: { received: unknown[] }, count: number) {
    await vi.waitFor(() => expect(probe.received).toHaveLength(count))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  afterEach(() => {
    for (const tab of otherTabs) tab.close()
    otherTabs = []
    resetSessionForTests()
    Reflect.deleteProperty(navigator, 'locks')
    vi.unstubAllGlobals()
  })

  // POST /auth/refresh rotates the SHARED cookie. Two tabs refreshing at once
  // present the same token twice, and the second is reuse.
  it('serialises refreshes from different tabs under the auth-refresh lock', async () => {
    const requested = stubLocks()
    let active = 0
    let maxActive = 0
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        refreshCount += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        await delay(20)
        active -= 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )

    // Each tab has its own single-flight promise; dropping inFlight between the
    // two calls models a second tab rather than a second caller in this one.
    const firstTab = ensureSession()
    resetSessionForTests()
    const secondTab = ensureSession()
    await Promise.all([firstTab, secondTab])

    expect(refreshCount).toBe(2)
    expect(maxActive).toBe(1)
    expect(requested).toEqual(['auth-refresh', 'auth-refresh'])
  })

  it('still refreshes where navigator.locks is missing', async () => {
    expect('locks' in navigator).toBe(false)
    await expect(ensureSession()).resolves.toBe('fresh-token')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('signs this tab out and redirects when another tab broadcasts a logout', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation('/tenants', '?page=2')
    installAuthBroadcastListener()

    openOtherTab().tab.postMessage({ type: 'logout' })

    await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(assign).toHaveBeenCalledWith(
      `${ROUTES.login}?redirect=${encodeURIComponent('/tenants?page=2')}`
    )
  })

  it('installs the listener once, however often bootstrap asks', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation()
    const first = installAuthBroadcastListener()
    expect(installAuthBroadcastListener()).toBe(first)

    openOtherTab().tab.postMessage({ type: 'logout' })

    await vi.waitFor(() => expect(assign).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(assign).toHaveBeenCalledTimes(1)
  })

  // A tab already signed out (sitting on /login, say) has nothing to end, and
  // redirecting it would only reload the page.
  it('ignores a logout broadcast while already signed out', async () => {
    const assign = stubLocation(ROUTES.login)
    installAuthBroadcastListener()
    const probe = openOtherTab()

    openOtherTab().tab.postMessage({ type: 'logout' })

    await flushDeliveries(probe, 1)
    expect(assign).not.toHaveBeenCalled()
  })

  it('ignores a message that is not a logout', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation()
    installAuthBroadcastListener()
    const probe = openOtherTab()

    openOtherTab().tab.postMessage({ type: 'something-else' })

    await flushDeliveries(probe, 1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })

  it('broadcasts a logout other tabs hear, and does not act on its own', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const assign = stubLocation()
    installAuthBroadcastListener()
    const probe = openOtherTab()

    broadcastLogout()

    await flushDeliveries(probe, 1)
    expect(probe.received).toEqual([{ type: 'logout' }])
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })

  it('tells other tabs when a refresh 401 ends the session', async () => {
    useAuthStore.getState().login('stale', testUser)
    const probe = openOtherTab()
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))

    await expect(ensureSession()).rejects.toThrow()

    await vi.waitFor(() => expect(probe.received).toEqual([{ type: 'logout' }]))
  })

  // A failed refresh that is not a verdict left the session alive everywhere.
  it('does not broadcast when the refresh fails without a verdict', async () => {
    useAuthStore.getState().login('live-token', testUser)
    const probe = openOtherTab()
    server.use(http.post('/api/v1/auth/refresh', () => HttpResponse.error()))

    await expect(ensureSession()).rejects.toThrow()
    openOtherTab().tab.postMessage({ type: 'sentinel' })

    await flushDeliveries(probe, 1)
    expect(probe.received).toEqual([{ type: 'sentinel' }])
  })

  it('works, silently, where BroadcastChannel does not exist', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    resetSessionForTests()
    useAuthStore.getState().login('stale', testUser)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))

    expect(() => broadcastLogout()).not.toThrow()
    const cleanup = installAuthBroadcastListener()
    expect(() => cleanup()).not.toThrow()
    // The verdict path still signs this tab out without a channel to tell.
    await expect(ensureSession()).rejects.toThrow()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
