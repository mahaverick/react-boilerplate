/**
 * @file The analytics configuration, taken from the app's run-time
 * configuration (`getRuntimeConfig`). The three constants at the top are the
 * only lines that differ between the apps that share this module.
 */
import {
  getRuntimeConfig,
  type AnalyticsConsentMode,
  type RuntimeConfig,
} from '@/configs/runtime-config'

/** Sent as the `app` super property on every browser event. */
export const ANALYTICS_APP = 'react'

/**
 * The query keys a captured URL may keep. Every other key, and the hash, is
 * dropped before an event leaves the browser: `?token=` (invitation accept,
 * password reset, email verification), `register?email=` and a `?redirect=`
 * wrapping either would otherwise reach PostHog.
 */
export const ANALYTICS_URL_QUERY_ALLOWLIST: readonly string[] = ['tab']

/** Whether `ANALYTICS_CONSENT_MODE` is honoured; an app that says no always runs `opt_out`. */
export const SUPPORTS_CONSENT_MODES = true

export type { AnalyticsConsentMode }

/** The resolved configuration; `key` unset means analytics is inert. */
export interface AnalyticsConfig {
  key: string | undefined
  uiHost: string
  consentMode: AnalyticsConsentMode
  /** `https://` origins allowed to hand off an anonymous id. */
  handoffOrigins: readonly string[]
  /** `APP_ENVIRONMENT`, sent as the `environment` super property. */
  environment: string
}

/**
 * The analytics view of a run-time configuration, so tests can pass their own.
 * @param runtime - A parsed run-time configuration.
 * @returns The configuration; an app without consent modes always gets `opt_out`.
 */
export function analyticsConfigFrom(runtime: RuntimeConfig): AnalyticsConfig {
  return {
    key: runtime.posthogKey,
    uiHost: runtime.posthogUiHost,
    consentMode: SUPPORTS_CONSENT_MODES ? runtime.analyticsConsentMode : 'opt_out',
    handoffOrigins: runtime.analyticsHandoffOrigins,
    environment: runtime.appEnvironment,
  }
}

/**
 * This page's configuration.
 * @returns The analytics view of `getRuntimeConfig()`.
 */
export function getAnalyticsConfig(): AnalyticsConfig {
  return analyticsConfigFrom(getRuntimeConfig())
}

/**
 * Whether analytics can run at all: a key is set and the consent mode is not `off`.
 * @param config - Defaults to this page's configuration.
 * @returns False when nothing may load.
 */
export function isAnalyticsAvailable(config: AnalyticsConfig = getAnalyticsConfig()): boolean {
  return config.key !== undefined && config.consentMode !== 'off'
}
