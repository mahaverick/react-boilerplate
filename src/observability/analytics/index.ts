/**
 * @file The analytics module's public surface. Nothing outside this folder
 * imports posthog-js: the facade loads it on demand.
 */
export {
  ANALYTICS_PROXY_PATH,
  type AnalyticsConsent,
  denyAnalyticsConsent,
  getAnalyticsConsent,
  getAnalyticsSessionId,
  grantAnalyticsConsent,
  identifyUser,
  initAnalytics,
  resetAnalytics,
  setAnalyticsOptOut,
  setTenantGroup,
  subscribeAnalyticsConsent,
  track,
} from './analytics'
export {
  getAnalyticsConfig,
  type AnalyticsConfig,
  type AnalyticsConsentMode,
  isAnalyticsAvailable,
} from './config'
export {
  type AnalyticsKey,
  analyticsKey,
  type BrowserEvent,
  type BrowserEventProps,
} from './events'
export { PII_CLASS_NAME } from './posthog-options'
