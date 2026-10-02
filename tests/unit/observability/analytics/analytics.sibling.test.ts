import { http, HttpResponse } from 'msw'
import type { CaptureResult, PostHog } from 'posthog-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_APP } from '@/observability/analytics/config'
import { settle } from '@/tests/fixtures/timing'
import { analyticsConfigFor } from '@/tests/mocks/posthog'
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
  const tabs: Facade[] = []

  async function openTab(): Promise<{ facade: Facade; ph: PostHog; sent: CaptureResult[] }> {
    vi.resetModules()
    const sdk = await vi.importActual<typeof import('posthog-js')>('posthog-js')
    const ph = new sdk.PostHog()
    vi.doMock('posthog-js', () => ({ ...sdk, default: ph }))
    const facade = await import('@/observability/analytics/analytics')
    await facade.initAnalytics(analyticsConfigFor({ POSTHOG_KEY: KEY, APP_ENVIRONMENT: 'test' }))
    await expect.poll((): unknown => ph.get_property('app')).toBe(ANALYTICS_APP)
    const sent: CaptureResult[] = []
    ph.on('eventCaptured', (event: CaptureResult) => sent.push(event))
    vi.doUnmock('posthog-js')
    tabs.push(facade)
    return { facade, ph, sent }
  }

  beforeEach(() => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
  })

  afterEach(() => {
    for (const facade of tabs.splice(0)) facade.resetAnalyticsForTests()
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
})
