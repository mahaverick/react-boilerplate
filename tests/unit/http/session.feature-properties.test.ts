import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installAnalyticsIdentity, resetSessionForTests } from '@/http/session'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { forgetFeatureProperties, syncFeatureProperties } from '@/observability/flags/register'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID } from '@/tests/fixtures/ids'
import { testUser } from '@/tests/mocks/handlers'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

/** Test-slice values, typed for any app's slice. */
function values(record: Record<string, boolean | string>) {
  return record as unknown as Parameters<typeof syncFeatureProperties>[0]
}

describe('$feature/* bookkeeping follows the session', () => {
  beforeEach(async () => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    forgetFeatureProperties()
    useAuthStore.setState({
      accessToken: 'token',
      user: { ...testUser, id: USER_ID },
      isAuthenticated: true,
      isBootstrapped: true,
    })
    installAnalyticsIdentity(new QueryClient())
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
  })

  it('after a sign-out, the next sync registers afresh and unregisters nothing the reset already dropped', () => {
    syncFeatureProperties(values({ test_bool: true, test_exp: 'bold' }))
    useAuthStore.getState().logout()
    expect(sdk.properties).not.toHaveProperty('$feature/test_bool')
    sdk.calls = []

    // A partial slice on purpose: before a reset forgot the registered names, this sync unregistered test_bool.
    syncFeatureProperties(values({ test_exp: 'calm' }))

    expect(sdk.calls).toEqual(['register({"$feature/test_exp":"calm"})'])
  })
})
