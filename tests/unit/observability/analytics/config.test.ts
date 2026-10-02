import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRuntimeConfig, resetRuntimeConfigForTests } from '@/configs/runtime-config'
import {
  ANALYTICS_APP,
  ANALYTICS_URL_QUERY_ALLOWLIST,
  analyticsConfigFrom,
  getAnalyticsConfig,
  isAnalyticsAvailable,
} from '@/observability/analytics/config'
import { analyticsConfigFor } from '@/tests/mocks/posthog'

const KEY = 'phc_test_key_not_real'

describe('analyticsConfigFrom', () => {
  it('is inert with nothing configured, on the default UI host, opt_out and development', () => {
    expect(analyticsConfigFrom(parseRuntimeConfig({}).config)).toEqual({
      key: undefined,
      uiHost: 'https://us.posthog.com',
      consentMode: 'opt_out',
      handoffOrigins: [],
      environment: 'development',
    })
  })

  it('takes every analytics setting from the run-time configuration', () => {
    expect(
      analyticsConfigFor({
        POSTHOG_KEY: KEY,
        POSTHOG_UI_HOST: 'https://eu.posthog.com',
        ANALYTICS_CONSENT_MODE: 'required',
        ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com,https://blog.example.com',
        APP_ENVIRONMENT: 'staging',
      })
    ).toEqual({
      key: KEY,
      uiHost: 'https://eu.posthog.com',
      consentMode: 'required',
      handoffOrigins: ['https://www.example.com', 'https://blog.example.com'],
      environment: 'staging',
    })
  })
})

describe('getAnalyticsConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetRuntimeConfigForTests()
  })

  it('reads this page’s run-time configuration', () => {
    resetRuntimeConfigForTests()
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    vi.stubEnv('VITE_APP_ENVIRONMENT', 'test')
    expect(getAnalyticsConfig()).toMatchObject({ key: KEY, environment: 'test' })
  })
})

describe('isAnalyticsAvailable', () => {
  it.each([
    [{}, false],
    [{ POSTHOG_KEY: KEY }, true],
    [{ POSTHOG_KEY: KEY, ANALYTICS_CONSENT_MODE: 'off' }, false],
    [{ POSTHOG_KEY: KEY, ANALYTICS_CONSENT_MODE: 'not-a-mode' }, false],
  ])('%o → %s', (raw, expected) => {
    expect(isAnalyticsAvailable(analyticsConfigFor(raw))).toBe(expected)
  })
})

describe('the app constants', () => {
  it('names this app and keeps only `tab` in URLs', () => {
    expect(ANALYTICS_APP).toBe('react')
    expect(ANALYTICS_URL_QUERY_ALLOWLIST).toEqual(['tab'])
  })
})
