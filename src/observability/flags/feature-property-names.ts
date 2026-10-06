/**
 * @file The `$feature/*` names the flags module last registered, kept apart
 * from the code that registers them so a sign-out can forget them without
 * pulling that code into the first-visit bundle.
 */
import type { FeaturePropertyName } from '@/observability/analytics'

/** The names last registered, so a later sync can drop the ones it no longer sends. */
export const registeredFeatureNames = new Set<FeaturePropertyName>()

/**
 * Forgets the registered names without unregistering them: for a reset of
 * analytics, which drops the properties from this tab's events, and from the
 * SDK unless another tab's sign-in superseded this one (that SDK now holds the
 * other tab's person, and this tab leaves it alone). The next sync then
 * registers its values afresh rather than unregistering names.
 */
export function forgetFeatureProperties(): void {
  registeredFeatureNames.clear()
}
