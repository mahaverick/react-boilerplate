import { http, HttpResponse } from 'msw'
import posthog from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  identifyUser,
  initAnalytics,
  resetAnalytics,
  resetAnalyticsForTests,
} from '@/observability/analytics/analytics'
import { ANALYTICS_APP } from '@/observability/analytics/config'
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

    identifyUser('user-a')
    resetAnalytics()
    expect(posthog.get_property('app')).toBe(ANALYTICS_APP)
    expect(posthog.get_property('environment')).toBe('test')
    expect(posthog.get_distinct_id()).not.toBe('user-a')

    // The control: the SDK's own reset, which the facade wraps, really drops them.
    posthog.reset()
    expect(posthog.get_property('app')).toBeUndefined()
  })
})
