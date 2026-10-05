import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmSignedInUser,
  forgetStaleIdentity,
  grantAnalyticsConsent,
  identifyUser,
  initAnalytics,
  registerFeatureProperties,
  resetAnalytics,
  resetAnalyticsForTests,
  unregisterFeatureProperties,
  yieldSharedIdentity,
} from '@/observability/analytics/analytics'
import { ANALYTICS_APP } from '@/observability/analytics/config'
import {
  analyticsConfigFor,
  instance,
  posthogDefault,
  resetFakePosthog,
  sdk,
} from '@/tests/mocks/posthog'

vi.mock('posthog-js', async () => {
  const { posthogDefault: fake } = await import('@/tests/mocks/posthog')
  return { default: fake }
})

const KEY = 'phc_test_key_not_real'
const OPT_OUT = analyticsConfigFor({ POSTHOG_KEY: KEY, APP_ENVIRONMENT: 'test' })
/** The super properties alone, as every reset registers them again. */
const REGISTER = `register(${JSON.stringify({ app: ANALYTICS_APP, environment: 'test' })})`

beforeEach(() => {
  resetAnalyticsForTests()
  resetFakePosthog()
  posthogDefault.init.mockClear()
  instance.updateFlags.mockClear()
  instance.register.mockClear()
  window.localStorage.clear()
})

describe('posthog-js flags at load', () => {
  it('purges cached flags once, before the super properties are registered', async () => {
    await initAnalytics(OPT_OUT)
    expect(instance.updateFlags).toHaveBeenCalledTimes(1)
    expect(instance.updateFlags).toHaveBeenCalledWith({})
    const [purgeOrder] = instance.updateFlags.mock.invocationCallOrder
    const [firstRegisterOrder] = instance.register.mock.invocationCallOrder
    expect(purgeOrder).toBeLessThan(firstRegisterOrder ?? Number.POSITIVE_INFINITY)
  })

  it('never touches the SDK when analytics is inert', async () => {
    await initAnalytics(analyticsConfigFor())
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    expect(instance.updateFlags).not.toHaveBeenCalled()
    expect(sdk.calls).toEqual([])
  })
})

describe('$feature/* super properties', () => {
  it('registers them, queued before load and replayed in order', async () => {
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    await initAnalytics(OPT_OUT)
    expect(sdk.calls).toEqual([REGISTER, 'register({"$feature/test_exp":"bold"})'])
    expect(sdk.properties['$feature/test_exp']).toBe('bold')
  })

  it('unregisters them', async () => {
    await initAnalytics(OPT_OUT)
    registerFeatureProperties({ '$feature/test_exp': 'bold', '$feature/test_bool': true })
    unregisterFeatureProperties(['$feature/test_bool'])
    expect(sdk.calls.at(-1)).toBe('unregister("$feature/test_bool")')
    expect(sdk.properties).not.toHaveProperty('$feature/test_bool')
    expect(sdk.properties['$feature/test_exp']).toBe('bold')
  })

  it('puts them back whenever the super properties are registered again', async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    grantAnalyticsConsent()
    expect(sdk.calls).toContain(
      `register(${JSON.stringify({ app: ANALYTICS_APP, environment: 'test', '$feature/test_exp': 'bold' })})`
    )
  })

  it('drops them with the person on a reset', async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    resetAnalytics()
    expect(sdk.calls.slice(-1)).toEqual([REGISTER])
    expect(sdk.properties).not.toHaveProperty('$feature/test_exp')
  })
  it("does not hand a superseded tab's flags to the person who superseded it", async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    sdk.distinctId = 'user-b'
    yieldSharedIdentity()
    resetAnalytics()
    sdk.calls.length = 0
    grantAnalyticsConsent()
    expect(sdk.calls.filter((call) => call.startsWith('register('))).not.toEqual([])
    expect(sdk.calls.join('\n')).not.toContain('$feature/')
  })

  it('forgets them when a stale identity is forgotten', async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    forgetStaleIdentity()
    sdk.calls.length = 0
    grantAnalyticsConsent()
    expect(sdk.calls.join('\n')).not.toContain('$feature/')
  })

  it('keeps them when the same person is identified again after a reset of the SDK', async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    registerFeatureProperties({ '$feature/test_exp': 'bold' })
    sdk.distinctId = 'someone-else'
    sdk.userState = 'identified'
    yieldSharedIdentity()
    confirmSignedInUser('user-a')
    expect(sdk.properties['$feature/test_exp']).toBe('bold')
  })
})
