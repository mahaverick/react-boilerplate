/**
 * @file The analytics module's public surface. Nothing outside this folder
 * imports posthog-js: the facade loads it on demand.
 */
export {
  ANALYTICS_PROXY_PATH,
  type AnalyticsIdentity,
  type AnalyticsTenantAccess,
  capturePageview,
  clearTenantGroup,
  confirmSignedInUser,
  denyAnalyticsConsent,
  type FeaturePropertyName,
  forgetStaleIdentity,
  getAnalyticsConsent,
  getAnalyticsSessionIdFor,
  grantAnalyticsConsent,
  identifyUser,
  identityEpoch,
  initAnalytics,
  registerFeatureProperties,
  resetAnalytics,
  setAnalyticsOptOut,
  setTenantGroup,
  subscribeAnalyticsConsent,
  subscribeIdentitySuperseded,
  track,
  unregisterFeatureProperties,
  whenAnalyticsSettled,
  yieldSharedIdentity,
} from './analytics'
export {
  getAnalyticsConfig,
  type AnalyticsConfig,
  type AnalyticsConsentMode,
  isAnalyticsAvailable,
} from './config'
export { type AnalyticsKey, analyticsKey, type BrowserEvent } from './events'
export { PII_CLASS_NAME } from './posthog-options'
