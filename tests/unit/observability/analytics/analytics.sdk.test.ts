import { http, HttpResponse } from 'msw'
import posthog from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  identifyUser,
  initAnalytics,
  resetAnalytics,
  resetAnalyticsForTests,
} from '@/observability/analytics/analytics'
import { ANALYTICS_APP, ANALYTICS_PERSISTENCE_NAME } from '@/observability/analytics/config'
import { isPersistedIdentified } from '@/observability/analytics/handoff'
import { analyticsConfigFor } from '@/tests/mocks/posthog'
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
