import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRuntimeConfig,
  parseRuntimeConfig,
  rawFromViteEnv,
  resetRuntimeConfigForTests,
} from '@/configs/runtime-config'
import { readHandoff } from '@/observability/analytics/handoff'

const KEY = 'phc_test_key_not_real'

describe('parseRuntimeConfig', () => {
  it('is inert with nothing set, on the defaults', () => {
    expect(parseRuntimeConfig({})).toEqual({
      config: {
        posthogKey: undefined,
        posthogUiHost: 'https://us.posthog.com',
        analyticsConsentMode: 'opt_out',
        analyticsHandoffOrigins: [],
        appEnvironment: 'development',
      },
      invalid: [],
    })
  })

  it('reads every setting', () => {
    expect(
      parseRuntimeConfig({
        POSTHOG_KEY: KEY,
        POSTHOG_UI_HOST: 'https://eu.posthog.com',
        ANALYTICS_CONSENT_MODE: 'required',
        ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com,https://blog.example.com:8443',
        APP_ENVIRONMENT: 'staging-2',
      })
    ).toEqual({
      config: {
        posthogKey: KEY,
        posthogUiHost: 'https://eu.posthog.com',
        analyticsConsentMode: 'required',
        analyticsHandoffOrigins: ['https://www.example.com', 'https://blog.example.com:8443'],
        appEnvironment: 'staging-2',
      },
      invalid: [],
    })
  })

  it('treats an empty string, or anything that is not a string, as unset', () => {
    const { config, invalid } = parseRuntimeConfig({
      POSTHOG_KEY: '',
      POSTHOG_UI_HOST: 42,
      ANALYTICS_CONSENT_MODE: null,
    })
    expect(config.posthogKey).toBeUndefined()
    expect(config.posthogUiHost).toBe('https://us.posthog.com')
    expect(config.analyticsConsentMode).toBe('opt_out')
    expect(invalid).toEqual([])
  })

  it.each([
    ['POSTHOG_KEY', 'not-a-key'],
    ['POSTHOG_KEY', `phc_${'a'.repeat(7)}`],
    ['POSTHOG_KEY', `${KEY}"`],
    ['POSTHOG_UI_HOST', 'http://us.posthog.com'],
    ['POSTHOG_UI_HOST', 'https://us.posthog.com/'],
    ['POSTHOG_UI_HOST', 'https://us.posthog.com/path'],
    ['ANALYTICS_HANDOFF_ORIGINS', 'https://www.example.com, https://blog.example.com'],
    ['ANALYTICS_HANDOFF_ORIGINS', 'http://www.example.com'],
    ['ANALYTICS_HANDOFF_ORIGINS', 'https://www.example.com/blog'],
    ['APP_ENVIRONMENT', 'Production'],
    ['APP_ENVIRONMENT', 'a'.repeat(33)],
  ] as const)('refuses %s=%s and treats it as unset', (key, value) => {
    const { config, invalid } = parseRuntimeConfig({ [key]: value })
    expect(invalid).toEqual([key])
    expect(config).toEqual(parseRuntimeConfig({}).config)
  })

  it('turns analytics off for an unrecognised consent mode rather than capturing', () => {
    const { config, invalid } = parseRuntimeConfig({
      POSTHOG_KEY: KEY,
      ANALYTICS_CONSENT_MODE: 'requird',
    })
    expect(config.analyticsConsentMode).toBe('off')
    expect(invalid).toEqual(['ANALYTICS_CONSENT_MODE'])
  })
})

describe('rawFromViteEnv', () => {
  it('reads each setting with a VITE_ prefix and nothing else', () => {
    expect(
      rawFromViteEnv({ VITE_POSTHOG_KEY: KEY, POSTHOG_KEY: 'ignored', VITE_APP_ENVIRONMENT: 'dev' })
    ).toEqual({
      POSTHOG_KEY: KEY,
      POSTHOG_UI_HOST: undefined,
      ANALYTICS_CONSENT_MODE: undefined,
      ANALYTICS_HANDOFF_ORIGINS: undefined,
      APP_ENVIRONMENT: 'dev',
    })
  })
})

describe('handoff origin normalisation', () => {
  it('canonicalises case and the default port so a referrer origin matches', () => {
    const { config, invalid } = parseRuntimeConfig({
      ANALYTICS_HANDOFF_ORIGINS: 'https://WWW.Example.com,https://x.com:443,https://y.com:8443',
    })
    expect(invalid).toEqual([])
    expect(config.analyticsHandoffOrigins).toEqual([
      'https://www.example.com',
      'https://x.com',
      'https://y.com:8443',
    ])
    // Each referrer hands off its own id: an accepted id is refused the second time.
    for (const [referrer, did] of [
      ['https://www.example.com/blog', '01a0fc35-b7ee-7b93-b550-d8a7f98e30be'],
      ['https://x.com/', '01a0fc35-b7ee-7b93-b550-d8a7f98e30bf'],
    ]) {
      expect(
        readHandoff({ search: `?ph_did=${did}` }, referrer, config.analyticsHandoffOrigins, false)
      ).toEqual({ bootstrap: { distinctID: did } })
    }
  })

  it('refuses a list with a port no URL can carry, as unset', () => {
    const { config, invalid } = parseRuntimeConfig({
      ANALYTICS_HANDOFF_ORIGINS: 'https://x.com:99999',
    })
    expect(invalid).toEqual(['ANALYTICS_HANDOFF_ORIGINS'])
    expect(config.analyticsHandoffOrigins).toEqual([])
  })
})

describe('getRuntimeConfig', () => {
  beforeEach(() => {
    resetRuntimeConfigForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    delete window.__APP_CONFIG__
    resetRuntimeConfigForTests()
  })

  it('reads VITE_* from import.meta.env outside a production bundle, and ignores window', () => {
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    window.__APP_CONFIG__ = { POSTHOG_KEY: 'phc_test_key_not_real_window' }
    expect(getRuntimeConfig().posthogKey).toBe(KEY)
  })

  it('reads only window.__APP_CONFIG__ in a production bundle', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    window.__APP_CONFIG__ = {
      POSTHOG_KEY: 'phc_test_key_not_real_container',
      APP_ENVIRONMENT: 'production',
    }
    expect(getRuntimeConfig()).toMatchObject({
      posthogKey: 'phc_test_key_not_real_container',
      appEnvironment: 'production',
    })
  })

  it('is inert in a production bundle whose runtime-config.js did not load', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    expect(getRuntimeConfig().posthogKey).toBeUndefined()
  })

  it('reads once, and warns by name, never by value, about a refused setting', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_POSTHOG_KEY', 'pii-probe@example.test')
    const first = getRuntimeConfig()
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    expect(getRuntimeConfig()).toBe(first)
    expect(first.posthogKey).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Ignoring invalid run-time configuration: POSTHOG_KEY')
  })
})
