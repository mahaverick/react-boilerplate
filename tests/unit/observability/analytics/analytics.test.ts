import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  denyAnalyticsConsent,
  getAnalyticsConsent,
  getAnalyticsSessionId,
  grantAnalyticsConsent,
  identifyUser,
  initAnalytics,
  MAX_QUEUED_COMMANDS,
  resetAnalytics,
  resetAnalyticsForTests,
  setAnalyticsOptOut,
  setTenantGroup,
  subscribeAnalyticsConsent,
  track,
} from '@/observability/analytics/analytics'
import { ANALYTICS_APP, ANALYTICS_PERSISTENCE_NAME } from '@/observability/analytics/config'
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
const STORAGE_NAME = ANALYTICS_PERSISTENCE_NAME
  ? `ph_${ANALYTICS_PERSISTENCE_NAME}`
  : `ph_${KEY}_posthog`
const OPT_OUT = analyticsConfigFor({ POSTHOG_KEY: KEY, APP_ENVIRONMENT: 'test' })
/** Built directly: an app without consent modes maps `required` to `opt_out`, and the facade is shared. */
const REQUIRED = {
  ...analyticsConfigFor({ POSTHOG_KEY: KEY, ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com' }),
  consentMode: 'required' as const,
}
const DID = '01a0fc35-b7ee-7b93-b550-d8a7f98e30be'
/** The super properties call `init` makes, and every reset makes again. */
const REGISTER = `register(${JSON.stringify({ app: ANALYTICS_APP, environment: 'test' })})`

beforeEach(() => {
  resetAnalyticsForTests()
  resetFakePosthog()
  posthogDefault.init.mockClear()
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
})

describe('initAnalytics', () => {
  it('loads nothing without a key, and every call stays a no-op', async () => {
    await initAnalytics(analyticsConfigFor())
    identifyUser('user-a')
    track('tenant_switched')
    expect(posthogDefault.init).not.toHaveBeenCalled()
    expect(getAnalyticsSessionId()).toBeUndefined()
    expect(getAnalyticsConsent()).toBeUndefined()
  })

  it('loads nothing in consent mode off', async () => {
    await initAnalytics({ ...OPT_OUT, consentMode: 'off' })
    expect(posthogDefault.init).not.toHaveBeenCalled()
  })

  it('strips the handoff parameters even when inert', async () => {
    window.history.replaceState(null, '', `/dashboard?ph_did=${DID}&tab=a`)
    await initAnalytics(analyticsConfigFor())
    expect(window.location.search).toBe('?tab=a')
  })

  it('initialises once, through the proxy, and registers the app and environment first', async () => {
    await initAnalytics(OPT_OUT)
    await initAnalytics(OPT_OUT)
    expect(posthogDefault.init).toHaveBeenCalledTimes(1)
    expect(sdk.initKey).toBe(KEY)
    expect(sdk.initOptions?.api_host).toBe(`${window.location.origin}/api/v1/collect`)
    expect(sdk.calls[0]).toBe(REGISTER)
  })

  it('replays calls made before the SDK loaded, in order, inside loaded', async () => {
    identifyUser('user-a')
    setTenantGroup('tenant-1')
    track('onboarding_checklist_opened', { required_done: 1, required_total: 2 })
    expect(sdk.calls).toEqual([])

    await initAnalytics(OPT_OUT)

    expect(sdk.calls).toEqual([
      REGISTER,
      'identify("user-a")',
      'group("tenant", "tenant-1")',
      'capture("onboarding_checklist_opened", {"required_done":1,"required_total":2})',
    ])
  })

  it('applies an opted-out user before anything is captured', async () => {
    setAnalyticsOptOut(true)
    identifyUser('user-a')
    await initAnalytics(OPT_OUT)
    expect(sdk.calls.slice(1)).toEqual(['opt_out_capturing()', 'identify("user-a")'])
  })

  it('passes an accepted handoff as bootstrap', async () => {
    window.history.replaceState(null, '', `/register?ph_did=${DID}`)
    Object.defineProperty(document, 'referrer', {
      value: 'https://www.example.com/pricing',
      configurable: true,
    })
    await initAnalytics(
      analyticsConfigFor({
        POSTHOG_KEY: KEY,
        ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com',
      })
    )
    expect(sdk.initOptions?.bootstrap).toEqual({ distinctID: DID })
    expect(window.location.search).toBe('')
  })

  it('ignores a handoff when this browser already holds an identified person', async () => {
    window.localStorage.setItem(STORAGE_NAME, JSON.stringify({ $user_state: 'identified' }))
    window.history.replaceState(null, '', `/register?ph_did=${DID}`)
    Object.defineProperty(document, 'referrer', {
      value: 'https://www.example.com/pricing',
      configurable: true,
    })
    await initAnalytics(
      analyticsConfigFor({
        POSTHOG_KEY: KEY,
        ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com',
      })
    )
    expect(sdk.initOptions).not.toHaveProperty('bootstrap')
    expect(window.location.search).toBe('')
  })

  it('never hands off in required mode, where nothing persists before consent', async () => {
    window.history.replaceState(null, '', `/register?ph_did=${DID}`)
    Object.defineProperty(document, 'referrer', {
      value: 'https://www.example.com/pricing',
      configurable: true,
    })
    await initAnalytics(REQUIRED)
    expect(sdk.initOptions).not.toHaveProperty('bootstrap')
    expect(sdk.initOptions?.cookieless_mode).toBe('on_reject')
    expect(window.location.search).toBe('')
  })

  it('goes inert when the SDK throws on init', async () => {
    posthogDefault.init.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await expect(initAnalytics(OPT_OUT)).resolves.toBeUndefined()
    identifyUser('user-a')
    expect(sdk.calls).toEqual([])
  })
})

describe('the queue before the SDK loads', () => {
  it('drops the oldest event capture when full, never an identity, reset, group or consent call', async () => {
    identifyUser('user-a')
    setAnalyticsOptOut(false)
    for (let index = 0; index < MAX_QUEUED_COMMANDS + 5; index += 1) {
      track('onboarding_checklist_opened', { required_done: index, required_total: 0 })
    }
    resetAnalytics()
    setTenantGroup('tenant-1')
    identifyUser('user-b')
    await initAnalytics(OPT_OUT)

    const calls = sdk.calls.slice(1)
    expect(calls.filter((call) => call.startsWith('identify('))).toEqual([
      'identify("user-a")',
      'identify("user-b")',
    ])
    expect(calls).toContain('reset()')
    expect(calls).toContain('group("tenant", "tenant-1")')
    const captures = calls.filter((call) => call.startsWith('capture('))
    expect(captures.length).toBeLessThan(MAX_QUEUED_COMMANDS + 5)
    // The newest captures survive; the oldest were dropped.
    expect(captures.at(-1)).toContain(`"required_done":${MAX_QUEUED_COMMANDS + 4}`)
    expect(captures[0]).not.toContain('"required_done":0,')
  })

  it('keeps identity calls even when the queue is full of identity calls', async () => {
    for (let index = 0; index < MAX_QUEUED_COMMANDS + 3; index += 1) identifyUser(`user-${index}`)
    track('tenant_switched')
    await initAnalytics(OPT_OUT)
    const calls = sdk.calls.slice(1)
    expect(calls.filter((call) => call.startsWith('identify('))).toHaveLength(
      MAX_QUEUED_COMMANDS + 3
    )
    expect(calls.some((call) => call.startsWith('capture('))).toBe(false)
  })
})

describe('identity transitions', () => {
  beforeEach(async () => {
    await initAnalytics(OPT_OUT)
    sdk.calls = []
  })

  it('user A signs out, user B signs in: reset comes before B is identified', () => {
    identifyUser('user-a')
    resetAnalytics()
    identifyUser('user-b')
    expect(sdk.calls).toEqual(['identify("user-a")', 'reset()', REGISTER, 'identify("user-b")'])
  })

  it('resets first when a different person is still identified in this browser', () => {
    sdk.distinctId = 'user-a'
    sdk.userState = 'identified'
    identifyUser('user-b')
    expect(sdk.calls).toEqual(['reset()', REGISTER, 'identify("user-b")'])
  })

  it('does not reset when the same person is restored', () => {
    sdk.distinctId = 'user-a'
    sdk.userState = 'identified'
    identifyUser('user-a')
    expect(sdk.calls).toEqual(['identify("user-a")'])
  })

  it('puts the super properties and the consent answer back after a reset', () => {
    sdk.consent = 'denied'
    resetAnalytics()
    expect(sdk.calls).toEqual(['reset()', REGISTER, 'opt_out_capturing()'])
    sdk.calls = []
    sdk.consent = 'granted'
    resetAnalytics()
    expect(sdk.calls).toEqual(['reset()', REGISTER, 'opt_in_capturing()'])
  })

  it('swallows a throwing SDK call', () => {
    instance.identify.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => identifyUser('user-a')).not.toThrow()
  })
})

describe('setTenantGroup', () => {
  beforeEach(async () => {
    await initAnalytics(OPT_OUT)
    sdk.calls = []
  })

  it('groups the first tenant without calling it a switch, then reports each switch once', () => {
    setTenantGroup('tenant-1')
    setTenantGroup('tenant-1')
    setTenantGroup('tenant-2')
    expect(sdk.calls).toEqual([
      'group("tenant", "tenant-1")',
      'group("tenant", "tenant-2")',
      'capture("tenant_switched", {})',
    ])
  })

  it('forgets the tenant on reset, so the next one is not a switch', () => {
    setTenantGroup('tenant-1')
    resetAnalytics()
    setTenantGroup('tenant-2')
    expect(sdk.calls).toEqual([
      'group("tenant", "tenant-1")',
      'reset()',
      REGISTER,
      'group("tenant", "tenant-2")',
    ])
  })
})

describe('consent', () => {
  it('opt_out mode: the profile opts out and back in', async () => {
    await initAnalytics(OPT_OUT)
    sdk.calls = []
    setAnalyticsOptOut(true)
    setAnalyticsOptOut(true)
    setAnalyticsOptOut(false)
    setAnalyticsOptOut(false)
    expect(sdk.calls).toEqual(['opt_out_capturing()', 'opt_in_capturing()'])
  })

  it('required mode: the profile can opt out but never stands in for consent', async () => {
    await initAnalytics(REQUIRED)
    sdk.calls = []
    setAnalyticsOptOut(false)
    expect(sdk.calls).toEqual([])
    setAnalyticsOptOut(true)
    expect(sdk.calls).toEqual(['opt_out_capturing()'])
  })

  it('the banner grants and denies, and subscribers hear each change', async () => {
    await initAnalytics(REQUIRED)
    const listener = vi.fn()
    const unsubscribe = subscribeAnalyticsConsent(listener)
    expect(getAnalyticsConsent()).toBe('pending')
    grantAnalyticsConsent()
    expect(getAnalyticsConsent()).toBe('granted')
    denyAnalyticsConsent()
    expect(getAnalyticsConsent()).toBe('denied')
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    grantAnalyticsConsent()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('getAnalyticsSessionId', () => {
  it('is undefined before the SDK loads', () => {
    expect(getAnalyticsSessionId()).toBeUndefined()
  })

  it('returns the session id while capturing in opt_out mode, and nothing once opted out', async () => {
    await initAnalytics(OPT_OUT)
    expect(getAnalyticsSessionId()).toBe(sdk.sessionId)
    setAnalyticsOptOut(true)
    expect(getAnalyticsSessionId()).toBeUndefined()
  })

  it('returns nothing in required mode until consent is granted', async () => {
    await initAnalytics(REQUIRED)
    expect(getAnalyticsSessionId()).toBeUndefined()
    grantAnalyticsConsent()
    expect(getAnalyticsSessionId()).toBe(sdk.sessionId)
  })
})
