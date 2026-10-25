/**
 * @file The entitlement catalog key as an analytics key. Its own module, not
 * the event registry's: the registry sits in the first-visit JS, and only the
 * lazy upgrade prompts need this (pnpm check:bundle).
 */
import { analyticsKey, type AnalyticsKey } from '@/observability/telemetry/event-registry'

/**
 * Maps an entitlement catalog key to an `AnalyticsKey`. A key the registry does
 * not know becomes `other`, so a new catalog key never sends free text.
 * @param key - The catalog key, such as `members`.
 * @returns The fixed analytics key.
 */
export function entitlementAnalyticsKey(key: string): AnalyticsKey {
  switch (key) {
    case 'members':
      return analyticsKey('members')
    case 'advanced_example':
      return analyticsKey('advanced_example')
    default:
      return analyticsKey('other')
  }
}
