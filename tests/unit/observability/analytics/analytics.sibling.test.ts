import { http, HttpResponse } from 'msw'
import type { CaptureResult, PostHog } from 'posthog-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_APP, ANALYTICS_PERSISTENCE_NAME } from '@/observability/analytics/config'
import { settle } from '@/tests/fixtures/timing'
import { analyticsConfigFor, stopPersisting } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

const KEY = 'phc_test_key_not_real'

/**
 * A website on a sibling subdomain shares this app's identity cookie, and
 * posthog-js adopts whatever that cookie says before every event. These run
 * the real, pinned posthog-js twice in one page (the app's instance through
 * the facade, and a second standing in for the website) to show the facade's
 * event guard undoing a sibling's identify or reset, `IDENTITY_REPAIR_DELAY_MS`
 * later. Each test loads a fresh SDK and facade: posthog-js initialises an
 * instance once.
 */
describe('a sibling sharing the identity cookie', () => {
  let sent: CaptureResult[]
  let website: PostHog
  let posthog: PostHog
  let facade: typeof import('@/observability/analytics/analytics')

  beforeEach(async () => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
    sent = []
    vi.resetModules()
    const sdk = await vi.importActual<typeof import('posthog-js')>('posthog-js')
    posthog = new sdk.PostHog()
    vi.doMock('posthog-js', () => ({ ...sdk, default: posthog }))
    facade = await import('@/observability/analytics/analytics')
    await facade.initAnalytics(analyticsConfigFor({ POSTHOG_KEY: KEY, APP_ENVIRONMENT: 'test' }))
    await expect.poll((): unknown => posthog.get_property('app')).toBe(ANALYTICS_APP)
    posthog.on('eventCaptured', (event: CaptureResult) => sent.push(event))
    website = new sdk.PostHog()
    website.init(KEY, {
      api_host: 'http://localhost:3000/api/v1/collect',
      defaults: '2026-08-30',
      persistence: 'localStorage+cookie',
      cross_subdomain_cookie: true,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      advanced_disable_flags: true,
    })
  })

  afterEach(() => {
    facade.resetAnalyticsForTests()
    stopPersisting(posthog)
    stopPersisting(website)
    window.localStorage.clear()
    window.sessionStorage.clear()
    for (const cookie of document.cookie.split('; ')) {
      const name = cookie.split('=')[0]
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  /** The app's pageviews captured since `from`, as the properties that decide attribution. */
  function pageviewsSince(from: number) {
    return sent
      .slice(from)
      .filter((event) => event.event === '$pageview')
      .map((event) => ({
        distinctId: event.properties.distinct_id as unknown,
        app: event.properties.app as unknown,
        tenant: (event.properties.$groups as Record<string, unknown> | undefined)?.tenant,
      }))
  }

  it('the website identifying a lead never files the signed-in user’s events under it', async () => {
    facade.identifyUser('user-a')
    facade.setTenantGroup('tenant-x')
    expect(posthog.get_distinct_id()).toBe('user-a')

    website.identify('lead-123')
    const from = sent.length
    facade.capturePageview()
    await vi.waitFor(() => expect(posthog.get_distinct_id()).toBe('user-a'))
    facade.capturePageview()

    expect(pageviewsSince(from)).toEqual([
      { distinctId: 'user-a', app: ANALYTICS_APP, tenant: 'tenant-x' },
    ])
    expect(sent.some((event) => event.properties.distinct_id === 'lead-123')).toBe(false)
  })

  it('the website resetting does not leave the signed-in tab anonymous, appless or ungrouped', async () => {
    facade.identifyUser('user-a')
    facade.setTenantGroup('tenant-x')

    website.reset()
    const from = sent.length
    facade.capturePageview()
    await vi.waitFor(() => expect(posthog.get_distinct_id()).toBe('user-a'))
    facade.capturePageview()

    expect(pageviewsSince(from)).toEqual([
      { distinctId: 'user-a', app: ANALYTICS_APP, tenant: 'tenant-x' },
    ])
  })

  /** The registry as another tab of this app leaves it, `ageMs` old. */
  function plantRegistry(distinctId: string, ageMs: number) {
    window.localStorage.setItem(
      'analytics-identity-registry',
      JSON.stringify([{ distinctId, at: Date.now() - ageMs }])
    )
  }

  it('an identity in the sibling registry supersedes the tab instead of being repaired', async () => {
    const superseded = vi.fn()
    facade.subscribeIdentitySuperseded(superseded)
    facade.identifyUser('user-a')
    plantRegistry('user-b', 1000)

    website.identify('user-b')
    facade.capturePageview()
    await vi.waitFor(() => expect(superseded).toHaveBeenCalled())
    expect(posthog.get_distinct_id()).toBe('user-b')
    expect(sent.filter((event) => event.event === '$identify')).toHaveLength(1)
  })

  it('an expired registry entry no longer counts: the foreign identity is repaired as before', async () => {
    const superseded = vi.fn()
    facade.subscribeIdentitySuperseded(superseded)
    facade.identifyUser('user-a')
    plantRegistry('lead-123', 61_000)

    website.identify('lead-123')
    facade.capturePageview()
    await vi.waitFor(() => expect(posthog.get_distinct_id()).toBe('user-a'))
    expect(superseded).not.toHaveBeenCalled()
  })

  it('identifying records the user in the registry, and signing out takes them out', () => {
    facade.identifyUser('user-a')
    const entries = JSON.parse(
      window.localStorage.getItem('analytics-identity-registry') ?? '[]'
    ) as { distinctId: string; at: number }[]
    expect(entries.map((entry) => entry.distinctId)).toEqual(['user-a'])
    expect(Date.now() - (entries[0]?.at ?? 0)).toBeLessThan(5000)

    facade.resetAnalytics()
    expect(window.localStorage.getItem('analytics-identity-registry')).toBeNull()
  })

  it('keeps the registry bounded, and drops expired entries', () => {
    const now = Date.now()
    window.localStorage.setItem(
      'analytics-identity-registry',
      JSON.stringify([
        { distinctId: 'closed-tab', at: now - 120_000 },
        ...Array.from({ length: 25 }, (_, index) => ({ distinctId: `planted-${index}`, at: now })),
      ])
    )
    facade.identifyUser('user-a')
    const entries = JSON.parse(
      window.localStorage.getItem('analytics-identity-registry') ?? '[]'
    ) as { distinctId: string }[]
    expect(entries).toHaveLength(20)
    expect(entries.at(-1)?.distinctId).toBe('user-a')
    expect(entries.some((entry) => entry.distinctId === 'closed-tab')).toBe(false)
  })

  it('storage that throws for the registry leaves identify, repair and sign-out as they were', async () => {
    const getItem = Reflect.get(Storage.prototype, 'getItem')
    const setItem = Reflect.get(Storage.prototype, 'setItem')
    const removeItem = Reflect.get(Storage.prototype, 'removeItem')
    const isRegistry = (key: string) => key === 'analytics-identity-registry'
    const reads = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key
    ) {
      if (isRegistry(key)) throw new Error('storage is blocked')
      return getItem.call(this, key)
    })
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (isRegistry(key)) throw new Error('storage is full')
      setItem.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (isRegistry(key)) throw new Error('storage is blocked')
      removeItem.call(this, key)
    })
    const superseded = vi.fn()
    facade.subscribeIdentitySuperseded(superseded)

    facade.identifyUser('user-a')
    expect(posthog.get_distinct_id()).toBe('user-a')
    expect(writes).toHaveBeenCalledWith('analytics-identity-registry', expect.any(String))

    website.identify('lead-123')
    facade.capturePageview()
    await vi.waitFor(() => expect(posthog.get_distinct_id()).toBe('user-a'))
    expect(reads).toHaveBeenCalledWith('analytics-identity-registry')
    expect(superseded).not.toHaveBeenCalled()

    expect(() => facade.resetAnalytics()).not.toThrow()
    vi.restoreAllMocks()
  })

  it('the control: without the guard, the website’s identify takes the app’s next event', () => {
    facade.identifyUser('user-a')
    website.identify('lead-123')
    posthog.set_config({ before_send: (event) => event })
    const from = sent.length
    posthog.capture('$pageview')
    expect(pageviewsSince(from)).toEqual([
      expect.objectContaining({ distinctId: 'lead-123' }) as unknown,
    ])
  })

  it('a signed-out visitor keeps app and tenant after the website resets', () => {
    facade.setTenantGroup('tenant-x')
    website.reset()
    const from = sent.length
    facade.capturePageview()
    expect(pageviewsSince(from)).toEqual([
      { distinctId: expect.any(String) as unknown, app: ANALYTICS_APP, tenant: 'tenant-x' },
    ])
  })
})

type Facade = typeof import('@/observability/analytics/analytics')

/**
 * Two tabs of this app share the identity cookie and storage too, and a
 * person one tab identifies is that tab's legitimate sign-in. Each tab here is
 * its own SDK and facade on one cookie jar, as the review's probe ran them.
 */
describe('two tabs of this app', () => {
  const tabs: { facade: Facade; ph: PostHog }[] = []

  async function openTab(
    consentMode: 'opt_out' | 'required' = 'opt_out',
    beforeLoad?: (facade: Facade) => Promise<void>
  ): Promise<{ facade: Facade; ph: PostHog; sent: CaptureResult[] }> {
    vi.resetModules()
    const sdk = await vi.importActual<typeof import('posthog-js')>('posthog-js')
    const ph = new sdk.PostHog()
    vi.doMock('posthog-js', () => ({ ...sdk, default: ph }))
    const facade = await import('@/observability/analytics/analytics')
    await beforeLoad?.(facade)
    // Built directly: an app without consent modes maps `required` to `opt_out`, and the facade is shared.
    await facade.initAnalytics({
      ...analyticsConfigFor({ POSTHOG_KEY: KEY, APP_ENVIRONMENT: 'test' }),
      consentMode,
    })
    await expect.poll((): unknown => ph.get_property('app')).toBe(ANALYTICS_APP)
    const sent: CaptureResult[] = []
    ph.on('eventCaptured', (event: CaptureResult) => sent.push(event))
    vi.doUnmock('posthog-js')
    tabs.push({ facade, ph })
    return { facade, ph, sent }
  }

  beforeEach(() => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
  })

  afterEach(() => {
    for (const { facade, ph } of tabs.splice(0)) {
      facade.resetAnalyticsForTests()
      stopPersisting(ph)
    }
    window.localStorage.clear()
    window.sessionStorage.clear()
    for (const cookie of document.cookie.split('; ')) {
      const name = cookie.split('=')[0]
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  const pageviews = (sent: CaptureResult[]) =>
    sent
      .filter((event) => event.event === '$pageview')
      .map((event): unknown => event.properties.distinct_id)
  const identifies = (sent: CaptureResult[]) => sent.filter((event) => event.event === '$identify')

  it('a second tab signing someone else in supersedes the first instead of a fight', async () => {
    const first = await openTab()
    const second = await openTab()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    await vi.waitFor(() => {
      first.facade.capturePageview()
      expect(superseded).toHaveBeenCalled()
    })
    for (let index = 0; index < 3; index += 1) {
      first.facade.capturePageview()
      second.facade.capturePageview()
    }
    // Long enough for any identity repair to have run.
    await vi.waitFor(() => expect(pageviews(second.sent).length).toBeGreaterThanOrEqual(3))
    expect(pageviews(second.sent).every((id) => id === 'user-b')).toBe(true)
    expect(pageviews(first.sent)).toEqual([])
    // No identity churn: the first tab never re-identifies over the second, which never re-identifies at all.
    expect(identifies(first.sent).map((event): unknown => event.properties.distinct_id)).toEqual([
      'user-a',
    ])
    expect(
      identifies(second.sent).every((event) => event.properties.distinct_id === 'user-b')
    ).toBe(true)
    expect(identifies(second.sent).length).toBeLessThanOrEqual(1)

    // The first tab signs out without resetting the second tab's person.
    first.facade.resetAnalytics()
    second.facade.capturePageview()
    expect(pageviews(second.sent).at(-1)).toBe('user-b')
  })

  it('writes nothing to the registry while consent is pending, and records the user once granted', async () => {
    const tab = await openTab('required')
    tab.facade.identifyUser('user-a')
    expect(window.localStorage.getItem('analytics-identity-registry')).toBeNull()

    tab.facade.grantAnalyticsConsent()
    const entries = JSON.parse(
      window.localStorage.getItem('analytics-identity-registry') ?? '[]'
    ) as { distinctId: string }[]
    expect(entries.map((entry) => entry.distinctId)).toEqual(['user-a'])
  })

  const registered = () =>
    (
      JSON.parse(window.localStorage.getItem('analytics-identity-registry') ?? '[]') as {
        distinctId: string
      }[]
    ).map((entry) => entry.distinctId)

  it('takes the user out of the registry when consent is denied, and again once opted out', async () => {
    const required = await openTab('required')
    required.facade.identifyUser('user-a')
    required.facade.grantAnalyticsConsent()
    expect(registered()).toEqual(['user-a'])
    required.facade.denyAnalyticsConsent()
    expect(registered()).toEqual([])
  })

  it('takes the user out of the registry when the profile opts out, and back in on opting in', async () => {
    const optOut = await openTab('opt_out')
    optOut.facade.identifyUser('user-b')
    expect(registered()).toEqual(['user-b'])
    optOut.facade.setAnalyticsOptOut(true)
    expect(registered()).toEqual([])
    optOut.facade.setAnalyticsOptOut(false)
    expect(registered()).toEqual(['user-b'])
  })

  /** Blocks the event loop, as a long task or a throttled background tab does. */
  function stallEventLoop(ms: number): void {
    const end = Date.now() + ms
    while (Date.now() < end) {
      // Nothing runs, so a timer comes due and a message stays queued.
    }
  }

  it('after a stalled event loop the registry still supersedes the tab instead of repairing', async () => {
    const first = await openTab()
    const second = await openTab()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    // The first tab's event finds the other tab's person and schedules the repair ...
    first.facade.capturePageview()
    // ... and the loop stalls past its delay, so the timer and the message are both due.
    stallEventLoop(first.facade.IDENTITY_REPAIR_DELAY_MS + 50)

    await vi.waitFor(() => expect(superseded).toHaveBeenCalled())
    await settle(50, 'absence has no event: a repair would have identified by now')
    expect(identifies(first.sent).map((event): unknown => event.properties.distinct_id)).toEqual([
      'user-a',
    ])
    expect(first.ph.get_distinct_id()).toBe('user-b')
  })

  it('one tab signing out: the other, signed out by the broadcast, never puts the person back', async () => {
    const first = await openTab()
    const second = await openTab()
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-a')
    const identifiedBefore = identifies(second.sent).length
    first.facade.resetAnalytics()
    second.facade.capturePageview()
    // The logout broadcast lands in the second tab, within the repair delay.
    second.facade.resetAnalytics()
    first.facade.capturePageview()
    await vi.waitFor(() => expect(pageviews(first.sent)).toHaveLength(1))
    await settle(
      first.facade.IDENTITY_REPAIR_DELAY_MS + 50,
      'absence has no event: the second tab’s identity repair would be due by now'
    )
    first.facade.capturePageview()
    expect(pageviews(first.sent).every((id) => id !== 'user-a')).toBe(true)
    expect(identifies(second.sent)).toHaveLength(identifiedBefore)
  })

  /** The tab's events that were really sent under a person: cookieless ones carry a placeholder. */
  const attributed = (sent: CaptureResult[]) =>
    sent
      .filter((event) => event.properties.$cookieless_mode !== true)
      .map((event): unknown => event.properties.distinct_id)

  /** Waits until `predicate` holds, for state the tabs reach through messages and timers. */
  const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true))

  it('a superseded tab resumes once the identity cookie holds its user again', async () => {
    const first = await openTab()
    const second = await openTab()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    await until(() => {
      first.facade.capturePageview()
      return superseded.mock.calls.length > 0
    })
    second.facade.resetAnalytics()
    second.facade.identifyUser('user-a')
    const from = first.sent.length
    for (let index = 0; index < 3; index += 1) first.facade.capturePageview()
    expect(pageviews(first.sent.slice(from))).toEqual(['user-a', 'user-a', 'user-a'])
    expect(attributed(first.sent).every((id) => id === 'user-a')).toBe(true)
  })

  it('a superseded tab whose refresh returns its own user resumes, and the other tab yields', async () => {
    const first = await openTab()
    const second = await openTab()
    const firstSuperseded = vi.fn()
    const secondSuperseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(firstSuperseded)
    second.facade.subscribeIdentitySuperseded(secondSuperseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    await until(() => {
      first.facade.capturePageview()
      return firstSuperseded.mock.calls.length > 0
    })
    // The session cookie is still A's: the app confirms A in the first tab.
    first.facade.confirmSignedInUser('user-a')
    first.facade.capturePageview()
    expect(pageviews(first.sent).at(-1)).toBe('user-a')
    await until(() => {
      second.facade.capturePageview()
      return secondSuperseded.mock.calls.length > 0
    })
    expect(attributed(first.sent).every((id) => id === 'user-a')).toBe(true)
    expect(attributed(second.sent).every((id) => id === 'user-b')).toBe(true)
  })

  it('a superseded tab accepting the banner never identifies over the other tab, which keeps sending', async () => {
    const first = await openTab('required')
    const second = await openTab('required')
    first.facade.grantAnalyticsConsent()
    second.facade.grantAnalyticsConsent()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    await until(() => {
      first.facade.capturePageview()
      return superseded.mock.calls.length > 0
    })

    first.facade.grantAnalyticsConsent()
    expect(second.ph.get_distinct_id()).toBe('user-b')
    const from = second.sent.length
    second.facade.capturePageview()
    expect(pageviews(second.sent.slice(from))).toEqual(['user-b'])

    // The first tab is signed out; the second keeps its person, its events, and is never superseded.
    const secondSuperseded = vi.fn()
    second.facade.subscribeIdentitySuperseded(secondSuperseded)
    first.facade.resetAnalytics()
    const afterSignOut = second.sent.length
    second.facade.capturePageview()
    await settle(
      second.facade.IDENTITY_REPAIR_DELAY_MS + 50,
      'absence has no event: any identity repair would be due by now'
    )
    second.facade.capturePageview()
    expect(pageviews(second.sent.slice(afterSignOut))).toEqual(['user-b', 'user-b'])
    expect(secondSuperseded).not.toHaveBeenCalled()
    expect(attributed(first.sent)).not.toContain('user-b')
    expect(attributed(second.sent)).not.toContain('user-a')
  })

  it('a tab whose refresh returned another user signs out without resetting that user’s identity', async () => {
    const first = await openTab()
    const second = await openTab()
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    const sessionBefore = second.ph.get_session_id()
    // What refreshSession does on SessionIdentityChangedError, before logout() resets analytics.
    first.facade.yieldSharedIdentity()
    first.facade.resetAnalytics()
    const from = second.sent.length
    second.facade.capturePageview()
    expect(pageviews(second.sent.slice(from))).toEqual(['user-b'])
    expect(second.ph.get_session_id()).toBe(sessionBefore)
  })

  it('a new tab whose restore failed without a verdict keeps a person another tab is signed in as', async () => {
    const signedIn = await openTab()
    signedIn.facade.identifyUser('user-a')
    const sessionBefore = signedIn.ph.get_session_id()
    const restored = await openTab('opt_out', async (facade) => {
      facade.forgetStaleIdentity({ keepIfAnotherTabHoldsThem: true })
      // The question is answered before this tab's SDK loads, as it is while the bundle loads.
      await settle(50, 'the other tab answers on the channel; there is no event for it here')
    })
    expect(restored.ph.get_distinct_id()).toBe('user-a')
    const from = signedIn.sent.length
    signedIn.facade.capturePageview()
    expect(pageviews(signedIn.sent.slice(from))).toEqual(['user-a'])
    expect(signedIn.ph.get_session_id()).toBe(sessionBefore)
  })

  it('a new tab whose restore failed with nobody answering forgets the person', async () => {
    const earlier = await openTab()
    earlier.facade.identifyUser('user-a')
    earlier.facade.resetAnalyticsForTests()
    const restored = await openTab('opt_out', async (facade) => {
      facade.forgetStaleIdentity({ keepIfAnotherTabHoldsThem: true })
      await settle(50, 'absence has no event: no tab answers on the channel')
    })
    expect(restored.ph.get_distinct_id()).not.toBe('user-a')
  })

  it('a tab whose refresh returned another user that no tab identified still resets its own user', async () => {
    const lone = await openTab()
    lone.facade.identifyUser('user-a')
    lone.facade.yieldSharedIdentity()
    lone.facade.resetAnalytics()
    expect(lone.ph.get_distinct_id()).not.toBe('user-a')
    expect(lone.ph.get_property('$user_state')).not.toBe('identified')
  })

  /** Every `$feature/*` property each event carries, by event. */
  const featuresOf = (sent: CaptureResult[]) =>
    sent.map((event) =>
      Object.fromEntries(
        Object.entries(event.properties).filter(([name]) => name.startsWith('$feature/'))
      )
    )

  /** The `$feature/example_cta_experiment` the shared storage holds, and for whom. */
  const storedVariant = () => {
    const name = ANALYTICS_PERSISTENCE_NAME
      ? `ph_${ANALYTICS_PERSISTENCE_NAME}`
      : `ph_${KEY}_posthog`
    const blob = JSON.parse(window.localStorage.getItem(name) ?? '{}') as Record<string, unknown>
    return { distinctId: blob.distinct_id, variant: blob['$feature/example_cta_experiment'] }
  }

  it('a superseded tab never sends its signed-out user’s variants under the other tab’s person', async () => {
    const first = await openTab()
    const second = await openTab()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    first.facade.registerFeatureProperties({ '$feature/example_cta_experiment': 'control' })
    second.facade.identifyUser('user-b')
    await until(() => {
      first.facade.capturePageview()
      return superseded.mock.calls.length > 0
    })
    // posthog-js keeps A's variant across the adopted identity and saves it, debounced, as B's.
    await until(() => storedVariant().variant === 'control')
    expect(storedVariant().distinctId).toBe('user-b')
    // The refresh returned user B: the app hands the identity over and signs the first tab out.
    first.facade.yieldSharedIdentity()
    first.facade.resetAnalytics()

    const firstFrom = first.sent.length
    first.facade.capturePageview()
    first.facade.capturePageview()
    const secondFrom = second.sent.length
    second.facade.capturePageview()
    // A new page load as B reads the storage the first tab wrote.
    const reloaded = await openTab()
    reloaded.facade.identifyUser('user-b')
    const reloadedFrom = reloaded.sent.length
    reloaded.facade.capturePageview()

    expect(pageviews(first.sent.slice(firstFrom))).toEqual(['user-b', 'user-b'])
    expect(featuresOf(first.sent.slice(firstFrom))).toEqual([{}, {}])
    expect(pageviews(second.sent.slice(secondFrom))).toEqual(['user-b'])
    expect(featuresOf(second.sent.slice(secondFrom))).toEqual([{}])
    expect(pageviews(reloaded.sent.slice(reloadedFrom))).toEqual(['user-b'])
    expect(featuresOf(reloaded.sent.slice(reloadedFrom))).toEqual([{}])
  })

  it('a superseded tab registers no variant into the storage it shares with the other tab', async () => {
    const first = await openTab()
    const second = await openTab()
    const superseded = vi.fn()
    first.facade.subscribeIdentitySuperseded(superseded)
    first.facade.identifyUser('user-a')
    second.facade.identifyUser('user-b')
    await until(() => {
      first.facade.capturePageview()
      return superseded.mock.calls.length > 0
    })
    first.facade.registerFeatureProperties({ '$feature/example_cta_experiment': 'control' })
    first.ph.persistence?.flush()

    expect(first.ph.get_property('$feature/example_cta_experiment')).toBeUndefined()
    expect(storedVariant()).toEqual({ distinctId: 'user-b', variant: undefined })
  })

  it('an event carries exactly the variants its tab registered', async () => {
    const tab = await openTab()
    tab.facade.identifyUser('user-a')
    tab.facade.registerFeatureProperties({ '$feature/example_cta_experiment': 'bold' })
    // A variant the SDK holds that this tab never registered: storage an earlier page wrote.
    tab.ph.register({ '$feature/example_beta_page': true })
    const from = tab.sent.length
    tab.facade.capturePageview()
    tab.facade.unregisterFeatureProperties(['$feature/example_cta_experiment'])
    tab.facade.capturePageview()
    expect(featuresOf(tab.sent.slice(from))).toEqual([
      { '$feature/example_cta_experiment': 'bold' },
      {},
    ])
  })
})
