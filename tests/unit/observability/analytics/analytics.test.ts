import type { CaptureResult } from 'posthog-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  capturePageview,
  clearTenantGroup,
  denyAnalyticsConsent,
  forgetStaleIdentity,
  getAnalyticsConsent,
  getAnalyticsSessionId,
  getAnalyticsSessionIdFor,
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
/** The `tenant_access` registration that follows each tenant group. */
const MEMBER = 'register({"tenant_access":"member"})'
const PLATFORM = 'register({"tenant_access":"platform"})'

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
      MEMBER,
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
      MEMBER,
      'group("tenant", "tenant-2")',
      MEMBER,
      'capture("tenant_switched", {})',
    ])
  })

  it('forgets the tenant on reset, so the next one is not a switch', () => {
    setTenantGroup('tenant-1')
    resetAnalytics()
    setTenantGroup('tenant-2')
    expect(sdk.calls).toEqual([
      'group("tenant", "tenant-1")',
      MEMBER,
      'reset()',
      REGISTER,
      'group("tenant", "tenant-2")',
      MEMBER,
    ])
  })

  it('a non-tenant page leaves the group, and the tenant after it still counts as a switch', () => {
    setTenantGroup('tenant-a')
    clearTenantGroup()
    clearTenantGroup()
    setTenantGroup('tenant-b')
    expect(sdk.calls).toEqual([
      'group("tenant", "tenant-a")',
      MEMBER,
      'resetGroups()',
      'unregister("tenant_access")',
      'group("tenant", "tenant-b")',
      MEMBER,
      'capture("tenant_switched", {})',
    ])
  })

  it('returning to the same tenant across a non-tenant page is not a switch', () => {
    setTenantGroup('tenant-a')
    clearTenantGroup()
    setTenantGroup('tenant-a')
    expect(sdk.calls.filter((call) => call.startsWith('capture('))).toEqual([])
    expect(sdk.properties).toMatchObject({
      $groups: { tenant: 'tenant-a' },
      tenant_access: 'member',
    })
  })

  it('marks staff platform access, and a member visit of the same tenant replaces it', () => {
    setTenantGroup('tenant-a', 'platform')
    setTenantGroup('tenant-a', 'member')
    expect(sdk.calls).toEqual([
      'group("tenant", "tenant-a")',
      PLATFORM,
      'group("tenant", "tenant-a")',
      MEMBER,
    ])
  })

  it('keeps the tenant group when a different stale person is reset under it', () => {
    setTenantGroup('tenant-a')
    sdk.distinctId = 'user-old'
    sdk.userState = 'identified'
    sdk.calls = []
    identifyUser('user-b')
    expect(sdk.calls).toEqual([
      'reset()',
      REGISTER,
      'group("tenant", "tenant-a")',
      MEMBER,
      'identify("user-b")',
    ])
  })
})

describe('pageviews and the tenant group', () => {
  it('replays the group before the pageview of the route that set it', async () => {
    setTenantGroup('tenant-b', 'platform')
    capturePageview()
    clearTenantGroup()
    capturePageview()
    await initAnalytics(OPT_OUT)
    expect(sdk.calls).toEqual([
      REGISTER,
      'group("tenant", "tenant-b")',
      PLATFORM,
      'capture("$pageview", {})',
      'resetGroups()',
      'unregister("tenant_access")',
      'capture("$pageview", {})',
    ])
  })

  it('drops a tenant group an earlier page load left in storage before anything is sent', async () => {
    sdk.properties = { $groups: { tenant: 'tenant-stale' }, tenant_access: 'platform' }
    capturePageview()
    await initAnalytics(OPT_OUT)
    expect(sdk.calls).toEqual([
      REGISTER,
      'resetGroups()',
      'unregister("tenant_access")',
      'capture("$pageview", {})',
    ])
  })

  it('turns posthog-js’s own history pageviews off', async () => {
    await initAnalytics(OPT_OUT)
    expect(sdk.initOptions).toMatchObject({ capture_pageview: false, capture_pageleave: true })
  })
})

describe('forgetStaleIdentity', () => {
  beforeEach(async () => {
    await initAnalytics(OPT_OUT)
    sdk.calls = []
  })

  it('resets a person an earlier visit left identified', () => {
    sdk.distinctId = 'user-a'
    sdk.userState = 'identified'
    forgetStaleIdentity()
    expect(sdk.calls).toEqual(['reset()', REGISTER])
    expect(sdk.distinctId).not.toBe('user-a')
  })

  it('leaves an anonymous browser, a handed-off visitor included, alone', () => {
    sdk.distinctId = DID
    forgetStaleIdentity()
    expect(sdk.calls).toEqual([])
    expect(sdk.distinctId).toBe(DID)
  })
})

/** The guard posthog-js runs on every event, as the facade configured it. */
function beforeSend(event: CaptureResult): CaptureResult | null {
  const hook = sdk.initOptions?.before_send as (event: CaptureResult | null) => CaptureResult | null
  return hook(event)
}

function eventOf(name: string, properties: Record<string, unknown>): CaptureResult {
  return { uuid: 'u', event: name, properties }
}

const SIGNED_IN = { app: ANALYTICS_APP, environment: 'test', distinct_id: 'user-a' }

describe('the event guard', () => {
  beforeEach(async () => {
    await initAnalytics(OPT_OUT)
    identifyUser('user-a')
    sdk.calls = []
  })

  it('sends a signed-in user’s own event unchanged, and repairs nothing', async () => {
    const event = eventOf('$pageview', SIGNED_IN)
    expect(beforeSend(event)).toEqual(event)
    await Promise.resolve()
    expect(sdk.calls).toEqual([])
  })

  it('drops an event a sibling re-identified, then identifies the signed-in user again', async () => {
    setTenantGroup('tenant-a')
    sdk.calls = []
    sdk.distinctId = 'lead-123'
    sdk.userState = 'identified'
    expect(
      beforeSend(eventOf('$autocapture', { ...SIGNED_IN, distinct_id: 'lead-123' }))
    ).toBeNull()
    expect(beforeSend(eventOf('$snapshot', { distinct_id: 'lead-123' }))).toBeNull()
    expect(sdk.calls).toEqual([])
    await Promise.resolve()
    expect(sdk.calls).toEqual([
      'reset()',
      REGISTER,
      'group("tenant", "tenant-a")',
      MEMBER,
      'identify("user-a")',
      REGISTER,
      'group("tenant", "tenant-a")',
      MEMBER,
    ])
    expect(sdk.distinctId).toBe('user-a')
    const event = eventOf('$pageview', {
      ...SIGNED_IN,
      $groups: { tenant: 'tenant-a' },
      tenant_access: 'member',
    })
    expect(beforeSend(event)).toEqual(event)
  })

  it('after a sibling reset, drops the anonymous event and identifies the user again without a reset', async () => {
    sdk.distinctId = 'anon-sibling'
    sdk.userState = 'anonymous'
    sdk.properties = {}
    expect(beforeSend(eventOf('$pageview', { distinct_id: 'anon-sibling' }))).toBeNull()
    await Promise.resolve()
    expect(sdk.calls).toEqual(['identify("user-a")', REGISTER])
  })

  it('repairs a burst of events with one repair', async () => {
    sdk.distinctId = 'lead-123'
    sdk.userState = 'identified'
    for (let index = 0; index < 5; index += 1) {
      beforeSend(eventOf('$autocapture', { ...SIGNED_IN, distinct_id: 'lead-123' }))
    }
    await Promise.resolve()
    expect(sdk.calls.filter((call) => call.startsWith('identify('))).toEqual(['identify("user-a")'])
  })

  it('puts back app, environment and the tenant group a sibling reset cleared, and registers them again', async () => {
    setTenantGroup('tenant-a', 'platform')
    sdk.calls = []
    sdk.properties = {}
    const sent = beforeSend(eventOf('$autocapture', { distinct_id: 'user-a', $el_text: 'x' }))
    expect(sent?.properties).toEqual({
      distinct_id: 'user-a',
      $el_text: 'x',
      app: ANALYTICS_APP,
      environment: 'test',
      $groups: { tenant: 'tenant-a' },
      tenant_access: 'platform',
    })
    await Promise.resolve()
    expect(sdk.calls).toEqual([REGISTER, 'group("tenant", "tenant-a")', PLATFORM])
  })

  it('strips a tenant group the tab is not on', () => {
    const sent = beforeSend(
      eventOf('$pageview', {
        ...SIGNED_IN,
        $groups: { tenant: 'tenant-stale' },
        tenant_access: 'member',
      })
    )
    expect(sent?.properties).toEqual(SIGNED_IN)
  })

  it('leaves replay and cookieless events alone', () => {
    const snapshot = eventOf('$snapshot', { distinct_id: 'user-a' })
    expect(beforeSend(snapshot)).toEqual(snapshot)
    const cookieless = eventOf('$pageview', {
      distinct_id: '$posthog_cookieless',
      $cookieless_mode: true,
    })
    expect(beforeSend(cookieless)).toEqual(cookieless)
  })

  it('stops guarding once the user signs out', async () => {
    resetAnalytics()
    const event = eventOf('$pageview', {
      app: ANALYTICS_APP,
      environment: 'test',
      distinct_id: 'anon-2',
    })
    expect(beforeSend(event)).toEqual(event)
    await Promise.resolve()
    expect(sdk.calls.filter((call) => call.startsWith('identify('))).toEqual([])
  })

  it('does not drop the consent event a sign-out reset captures', () => {
    sdk.consent = 'granted'
    instance.opt_in_capturing.mockImplementationOnce(() => {
      expect(
        beforeSend(
          eventOf('$opt_in', { app: ANALYTICS_APP, environment: 'test', distinct_id: 'anon-2' })
        )
      ).not.toBeNull()
    })
    resetAnalytics()
    expect(instance.opt_in_capturing).toHaveBeenCalled()
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

describe('getAnalyticsSessionIdFor', () => {
  beforeEach(async () => {
    await initAnalytics(OPT_OUT)
  })

  it('is the session id while PostHog is anonymous, whoever is signed in', () => {
    expect(getAnalyticsSessionIdFor(null)).toBe(sdk.sessionId)
    expect(getAnalyticsSessionIdFor('user-b')).toBe(sdk.sessionId)
  })

  it('is the session id when PostHog holds the signed-in user', () => {
    sdk.distinctId = 'user-a'
    sdk.userState = 'identified'
    expect(getAnalyticsSessionIdFor('user-a')).toBe(sdk.sessionId)
  })

  it('is nothing when PostHog holds someone else, or someone while nobody is signed in', () => {
    sdk.distinctId = 'user-a'
    sdk.userState = 'identified'
    expect(getAnalyticsSessionIdFor(null)).toBeUndefined()
    expect(getAnalyticsSessionIdFor('user-b')).toBeUndefined()
  })

  it('is nothing before the SDK loads', () => {
    resetAnalyticsForTests()
    expect(getAnalyticsSessionIdFor(null)).toBeUndefined()
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
