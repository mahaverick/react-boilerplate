/**
 * @file The analytics module's public surface. Nothing outside this folder
 * imports posthog-js: the facade loads it on demand.
 */
export {
  ANALYTICS_PROXY_PATH,
  type AnalyticsConsent,
  type AnalyticsIdentity,
  type AnalyticsTenantAccess,
  capturePageview,
  clearTenantGroup,
  confirmSignedInUser,
  denyAnalyticsConsent,
  forgetStaleIdentity,
  getAnalyticsConsent,
  getAnalyticsSessionIdFor,
  grantAnalyticsConsent,
  identifyUser,
  identityEpoch,
  initAnalytics,
  resetAnalytics,
  setAnalyticsOptOut,
  setTenantGroup,
  subscribeAnalyticsConsent,
  subscribeIdentitySuperseded,
  track,
  whenAnalyticsSettled,
  yieldSharedIdentity,
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
