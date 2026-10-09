import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTenantGroup,
  forgetStaleIdentity,
  grantAnalyticsConsent,
  identifyUser,
  identityEpoch,
  initAnalytics,
  resetAnalytics,
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

describe('identityEpoch', () => {
  it.each([
    ['identifyUser', () => undefined, () => identifyUser('user-a')],
    ['identifyUser for another user', () => identifyUser('user-a'), () => identifyUser('user-b')],
    ['resetAnalytics', () => undefined, () => resetAnalytics()],
    ['forgetStaleIdentity', () => undefined, () => forgetStaleIdentity()],
    ['setTenantGroup', () => undefined, () => setTenantGroup('tenant-1')],
    [
      'setTenantGroup for another tenant',
      () => setTenantGroup('tenant-1'),
      () => setTenantGroup('tenant-2'),
    ],
    [
      'setTenantGroup with another access',
      () => setTenantGroup('tenant-1'),
      () => setTenantGroup('tenant-1', 'platform'),
    ],
    ['clearTenantGroup', () => setTenantGroup('tenant-1'), () => clearTenantGroup()],
  ])('changes at the call to %s, before the SDK loads', (_name, arrange, change) => {
    arrange()
    const before = identityEpoch()
    change()
    expect(identityEpoch()).not.toBe(before)
  })

  it('stays put while nothing changes the identity', () => {
    expect(identityEpoch()).toBe(identityEpoch())
  })

  it('a second setTenantGroup for the tenant already grouped leaves the epoch alone', async () => {
    await initAnalytics(OPT_OUT)
    setTenantGroup('tenant-1')
    const before = identityEpoch()
    setTenantGroup('tenant-1')
    expect(identityEpoch()).toBe(before)
  })

  it('a session refresh re-identifying the same user leaves the epoch alone', async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    const before = identityEpoch()
    identifyUser('user-a')
    expect(identityEpoch()).toBe(before)
  })

  it('leaving a non-tenant page for another non-tenant page leaves the epoch alone', async () => {
    await initAnalytics(OPT_OUT)
    clearTenantGroup()
    const before = identityEpoch()
    clearTenantGroup()
    expect(identityEpoch()).toBe(before)
  })

  it('identifying the same user again after a sign-out changes it', () => {
    identifyUser('user-a')
    resetAnalytics()
    const before = identityEpoch()
    identifyUser('user-a')
    expect(identityEpoch()).not.toBe(before)
  })
})
