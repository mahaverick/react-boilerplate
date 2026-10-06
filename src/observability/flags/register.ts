/**
 * @file The flag values as `$feature/<flag>` super properties, so ordinary
 * browser events carry the variant an experiment's metrics break down by.
 * Through the analytics facade, so they are no-ops when analytics is inert.
 */
import {
  registerFeatureProperties,
  unregisterFeatureProperties,
  type FeaturePropertyName,
} from '@/observability/analytics'
import type { ClientFlagKey } from './flag-types'
import { clientFlagKeys } from './flag-values'

/** The names this module last registered, so a later sync can drop the ones it no longer sends. */
let registeredNames = new Set<FeaturePropertyName>()

/**
 * The super property that carries a flag's value.
 * @param key - A flag this app reads.
 * @returns `$feature/<key>`.
 */
export function featurePropertyName(key: ClientFlagKey): FeaturePropertyName {
  const name: string = key
  return `$feature/${name}`
}

/**
 * Registers `$feature/<key>` for every flag in `values` and unregisters the
 * ones registered before that `values` no longer has; null unregisters all.
 * @param values - The current scope's values, or null when there are none.
 */
export function syncFeatureProperties(
  values: Readonly<Partial<Record<ClientFlagKey, boolean | string>>> | null
): void {
  const next: Record<FeaturePropertyName, boolean | string> = {}
  if (values) {
    for (const key of clientFlagKeys()) {
      const value = values[key]
      if (value !== undefined) next[featurePropertyName(key)] = value
    }
  }
  const stale = [...registeredNames].filter((name) => !(name in next))
  if (stale.length > 0) unregisterFeatureProperties(stale)
  if (Object.keys(next).length > 0) registerFeatureProperties(next)
  registeredNames = new Set(Object.keys(next) as FeaturePropertyName[])
}

/**
 * Forgets what this module registered, without unregistering it: for a reset
 * of analytics, which drops the properties itself, so the next sync registers
 * its values afresh rather than unregistering names nothing holds.
 */
export function forgetFeatureProperties(): void {
  registeredNames = new Set()
}
