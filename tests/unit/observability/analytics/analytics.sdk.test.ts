import { http, HttpResponse } from 'msw'
import posthog, { type CaptureResult, type PostHog } from 'posthog-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  identifyUser,
  initAnalytics,
  resetAnalytics,
  resetAnalyticsForTests,
} from '@/observability/analytics/analytics'
import { ANALYTICS_APP, ANALYTICS_PERSISTENCE_NAME } from '@/observability/analytics/config'
import { isPersistedIdentified } from '@/observability/analytics/handoff'
import { analyticsConfigFor, stopPersisting } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

/**
 * The facade over the real, pinned posthog-js (no stand-in), for the one
 * behaviour of the SDK the facade exists to undo: `reset()` drops every
 * `register()`ed property, so without the facade the next person's events
 * would not say which app or environment they came from.
 */
describe('the facade over the pinned posthog-js', () => {
  afterEach(() => {
    resetAnalyticsForTests()
    stopPersisting(posthog)
    window.localStorage.clear()
  })

  it('keeps app and environment on events after a sign-out reset', async () => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
    await initAnalytics(
      analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real', APP_ENVIRONMENT: 'test' })
    )
    await expect.poll((): unknown => posthog.get_property('app')).toBe(ANALYTICS_APP)

    // The storage name the facade configures is the one the handoff guard reads.
    const key = 'phc_test_key_not_real'
    const stored = ANALYTICS_PERSISTENCE_NAME
      ? `ph_${ANALYTICS_PERSISTENCE_NAME}`
      : `ph_${key}_posthog`
    expect(window.localStorage.getItem(stored)).not.toBeNull()
    identifyUser('user-a')
    await expect.poll(() => isPersistedIdentified(key, ANALYTICS_PERSISTENCE_NAME)).toBe(true)
    resetAnalytics()
    expect(posthog.get_property('app')).toBe(ANALYTICS_APP)
    expect(posthog.get_property('environment')).toBe('test')
    expect(posthog.get_distinct_id()).not.toBe('user-a')

    // The control: the SDK's own reset, which the facade wraps, really drops them.
    posthog.reset()
    expect(posthog.get_property('app')).toBeUndefined()
  })
})

/**
 * `required` mode over the real SDK: posthog-js drops every capture while the
 * banner is unanswered, the router's pageview of the landing page included,
 * and its own pageviews are off, so the facade captures the page on screen
 * when the banner is answered. Each test loads a fresh SDK and facade.
 */
describe('the banner answer over the pinned posthog-js', () => {
  let facade: typeof import('@/observability/analytics/analytics')
  let instance: PostHog

  async function loadRequired(): Promise<CaptureResult[]> {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
    vi.resetModules()
    const sdk = await vi.importActual<typeof import('posthog-js')>('posthog-js')
    instance = new sdk.PostHog()
    vi.doMock('posthog-js', () => ({ ...sdk, default: instance }))
    facade = await import('@/observability/analytics/analytics')
    facade.capturePageview()
    await facade.initAnalytics({
      ...analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real', APP_ENVIRONMENT: 'test' }),
      consentMode: 'required',
    })
    await expect.poll((): unknown => instance.get_property('app')).toBe(ANALYTICS_APP)
    const sent: CaptureResult[] = []
    instance.on('eventCaptured', (event: CaptureResult) => sent.push(event))
    return sent
  }

  afterEach(() => {
    facade.resetAnalyticsForTests()
    stopPersisting(instance)
    vi.doUnmock('posthog-js')
    window.localStorage.clear()
    window.sessionStorage.clear()
    for (const cookie of document.cookie.split('; ')) {
      const name = cookie.split('=')[0]
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  it('accept: the landing page gets exactly one $pageview, after $opt_in', async () => {
    const sent = await loadRequired()
    facade.grantAnalyticsConsent()
    facade.grantAnalyticsConsent()
    await vi.waitFor(() => expect(sent.map((event) => event.event)).toContain('$pageview'))
    const names = sent.map((event) => event.event)
    expect(names.filter((name) => name === '$pageview')).toHaveLength(1)
    expect(names.indexOf('$opt_in')).toBeLessThan(names.indexOf('$pageview'))
  })

  it('decline: the landing page gets exactly one $pageview, cookieless', async () => {
    const sent = await loadRequired()
    facade.denyAnalyticsConsent()
    facade.denyAnalyticsConsent()
    await vi.waitFor(() => expect(sent.map((event) => event.event)).toContain('$pageview'))
    const pageviews = sent.filter((event) => event.event === '$pageview')
    expect(pageviews).toHaveLength(1)
    expect(pageviews[0]?.properties.$cookieless_mode).toBe(true)
  })

  it('a signed-in user who declined and then accepts keeps $opt_in, under their own id', async () => {
    const sent = await loadRequired()
    facade.denyAnalyticsConsent()
    facade.identifyUser('user-a')
    facade.grantAnalyticsConsent()
    await vi.waitFor(() => expect(sent.map((event) => event.event)).toContain('$opt_in'))
    const optIn = sent.find((event) => event.event === '$opt_in')
    expect(optIn?.properties.distinct_id).toBe('user-a')
    expect(instance.get_distinct_id()).toBe('user-a')
  })
})
