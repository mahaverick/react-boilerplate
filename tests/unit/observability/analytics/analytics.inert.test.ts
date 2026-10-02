import { describe, expect, it, vi } from 'vitest'
import {
  identifyUser,
  initAnalytics,
  resetAnalyticsForTests,
  track,
} from '@/observability/analytics/analytics'
import { analyticsConfigFor } from '@/tests/mocks/posthog'

/**
 * Own file, so no other test in it can have loaded posthog-js first: the
 * module factory runs on the first `import('posthog-js')` in a file, so a
 * factory that never ran proves the SDK was never imported.
 */
const factoryRan = vi.hoisted(() => vi.fn())

vi.mock('posthog-js', () => {
  factoryRan()
  return { default: { init: vi.fn() } }
})

describe('an inert analytics module never imports posthog-js', () => {
  it('without a key', async () => {
    resetAnalyticsForTests()
    await initAnalytics(analyticsConfigFor())
    identifyUser('user-a')
    track('tenant_switched')
    expect(factoryRan).not.toHaveBeenCalled()
  })

  it('in consent mode off', async () => {
    resetAnalyticsForTests()
    await initAnalytics(
      analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real', ANALYTICS_CONSENT_MODE: 'off' })
    )
    expect(factoryRan).not.toHaveBeenCalled()
  })
})
