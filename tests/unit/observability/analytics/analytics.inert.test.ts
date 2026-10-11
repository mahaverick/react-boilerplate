import { describe, expect, it, vi } from 'vitest'
import {
  identifyUser,
  initAnalytics,
  resetAnalyticsForTests,
  track,
} from '@/observability/analytics/analytics'
import { analyticsConfigFor } from '@/tests/mocks/posthog'

/**
 * Counts runs of the posthog-js mock factory, which runs on a file's first
 * `import('posthog-js')`. This file holds only inert-mode tests, so a factory
 * that never ran proves the SDK was never imported.
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
    // Built directly: an app without consent modes maps `off` to `opt_out`, and the facade is shared.
    await initAnalytics({
      ...analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }),
      consentMode: 'off',
    })
    expect(factoryRan).not.toHaveBeenCalled()
  })
})
