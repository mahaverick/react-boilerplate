/**
 * @file The `$feature/*` properties the flags module last registered: the
 * state `register.ts` syncs against, and the session and the router forget
 * when analytics forgets the person.
 */
import type { FeaturePropertyName } from '@/observability/analytics'

/** The names and values last registered, so a later sync can drop or skip them. */
export const registeredFeatureProperties = new Map<FeaturePropertyName, boolean | string>()

/**
 * Forgets the registered properties without unregistering them: for a reset
 * of analytics, which drops them from this tab's events, and from the SDK
 * unless another tab's sign-in superseded this one (that SDK now holds the
 * other tab's person, and this tab leaves it alone). The next sync then
 * registers its values afresh rather than unregistering names.
 */
export function forgetFeatureProperties(): void {
  registeredFeatureProperties.clear()
}
