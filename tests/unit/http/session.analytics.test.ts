import axios from 'axios'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { ensureSession, installAnalyticsIdentity, resetSessionForTests } from '@/http/session'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

const userA = { ...testUser, id: USER_ID }
const userB = { ...testUser, id: USER_ID_2, email: 'b@b.com' }

/** The SDK calls after `init`'s own `register`. */
function sdkCalls(): string[] {
  return sdk.calls.filter((call) => !call.startsWith('register('))
}

describe('analytics identity follows the session', () => {
  beforeEach(async () => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    installAnalyticsIdentity()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
  })

  afterEach(() => vi.restoreAllMocks())

  it('identifies a user on sign-in, by id alone, after applying their preference', () => {
    useAuthStore.getState().login('token', userA)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('opts an opted-out user out before identifying them', () => {
    sdk.consent = 'pending'
    useAuthStore.getState().login('token', { ...userA, analyticsOptOut: true })
    expect(sdkCalls()).toEqual(['opt_out_capturing()', `identify("${USER_ID}")`])
  })

  it('user A signs out and user B signs in on the same tab: reset before B, and B never as A', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().logout()
    useAuthStore.getState().login('token', userB)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()', `identify("${USER_ID_2}")`])
    expect(sdk.distinctId).toBe(USER_ID_2)
  })

  it('user B replacing user A with no sign-out in between still resets first', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().login('token', userB)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()', `identify("${USER_ID_2}")`])
  })

  it('a profile refresh for the same user neither resets nor identifies again', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().login('token', { ...userA, firstName: 'Changed' })
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('a forced sign-out (the refresh answered 401) resets', async () => {
    useAuthStore.getState().login('stale', userA)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await expect(ensureSession()).rejects.toThrow()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()'])
  })

  it('a 401 verdict on an API request resets', async () => {
    useAuthStore.getState().login('token', userA)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    })
    server.use(http.get('/api/v1/widgets', () => fail('Invalid token', 401)))
    const client = axios.create({ baseURL: '/api/v1' })
    installInterceptors(client)
    await expect(client.get('/widgets')).rejects.toThrow()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()'])
  })

  it('a cold load with a dead cookie, never signed in, resets nothing', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await expect(ensureSession()).rejects.toThrow()
    expect(sdkCalls()).toEqual([])
  })

  it('identifies a user restored by the session refresh', async () => {
    server.use(http.get('/api/v1/profile', () => ok(userA, 'Profile retrieved.')))
    await ensureSession()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('is installed once however often it is called', () => {
    installAnalyticsIdentity()
    useAuthStore.getState().login('token', userA)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })
})

describe('installAnalyticsIdentity with a user already signed in', () => {
  it('identifies that user at once', async () => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    useAuthStore.setState({
      accessToken: 'token',
      user: userA,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    installAnalyticsIdentity()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })
})
