import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  grantAnalyticsConsent,
  identifyUser,
  initAnalytics,
  resetAnalyticsForTests,
  setAnalyticsOptOut,
  setTenantGroup,
  whenAnalyticsSettled,
} from '@/observability/analytics/analytics'
import { analyticsConfigFor, posthogDefault, resetFakePosthog, sdk } from '@/tests/mocks/posthog'

vi.mock('posthog-js', async () => {
  const { posthogDefault: fake } = await import('@/tests/mocks/posthog')
  return { default: fake }
})

const KEY = 'phc_test_key_not_real'
const OPT_OUT = analyticsConfigFor({ POSTHOG_KEY: KEY })
const REQUIRED = { ...OPT_OUT, consentMode: 'required' as const }

beforeEach(() => {
  resetAnalyticsForTests()
  resetFakePosthog()
  posthogDefault.init.mockClear()
})

describe('whenAnalyticsSettled', () => {
  it('waits for the SDK to load, then resolves with the consented identity', async () => {
    let settled: unknown = 'pending'
    void whenAnalyticsSettled().then((identity) => {
      settled = identity
    })
    await Promise.resolve()
    expect(settled).toBe('pending')

    identifyUser('user-a')
    setTenantGroup('tenant-1')
    await initAnalytics(OPT_OUT)

    await vi.waitFor(() => {
      expect(settled).toEqual({
        distinctId: 'user-a',
        sessionId: sdk.sessionId,
        windowId: sdk.windowId,
        groups: { tenant: 'tenant-1' },
      })
    })
  })

  it('resolves null once analytics turns inert without a key', async () => {
    const pending = whenAnalyticsSettled()
    await initAnalytics(analyticsConfigFor())
    await expect(pending).resolves.toBeNull()
  })

  it('resolves null in consent mode off', async () => {
    await initAnalytics({ ...OPT_OUT, consentMode: 'off' })
    await expect(whenAnalyticsSettled()).resolves.toBeNull()
  })

  it('resolves null after the user opts out, and has no group off a tenant page', async () => {
    await initAnalytics(OPT_OUT)
    await expect(whenAnalyticsSettled()).resolves.toEqual({
      distinctId: 'anon-1',
      sessionId: sdk.sessionId,
      windowId: sdk.windowId,
    })
    setAnalyticsOptOut(true)
    await expect(whenAnalyticsSettled()).resolves.toBeNull()
  })

  it('resolves null in required mode until consent is granted', async () => {
    await initAnalytics(REQUIRED)
    await expect(whenAnalyticsSettled()).resolves.toBeNull()
    grantAnalyticsConsent()
    await expect(whenAnalyticsSettled()).resolves.toMatchObject({ distinctId: 'anon-1' })
  })

  it('resolves null while posthog-js holds someone other than the signed-in user', async () => {
    identifyUser('user-a')
    await initAnalytics(OPT_OUT)
    sdk.distinctId = 'someone-else'
    await expect(whenAnalyticsSettled()).resolves.toBeNull()
  })

  it('resolves null when posthog-js fails to load', async () => {
    posthogDefault.init.mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    await initAnalytics(OPT_OUT)
    await expect(whenAnalyticsSettled()).resolves.toBeNull()
  })
})
