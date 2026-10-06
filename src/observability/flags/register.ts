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
import { registeredFeatureProperties } from './feature-property-names'
import type { ClientFlagKey } from './flag-types'
import { clientFlagKeys } from './flag-values'

export { forgetFeatureProperties } from './feature-property-names'

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
 * Does nothing when `values` holds exactly what is registered already, as
 * each navigation's sync usually does: a register is a write to storage.
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
  const entries = Object.entries(next) as [FeaturePropertyName, boolean | string][]
  const isUnchanged =
    entries.length === registeredFeatureProperties.size &&
    entries.every(([name, value]) => registeredFeatureProperties.get(name) === value)
  if (isUnchanged) return
  const stale = [...registeredFeatureProperties.keys()].filter((name) => !(name in next))
  if (stale.length > 0) unregisterFeatureProperties(stale)
  if (entries.length > 0) registerFeatureProperties(next)
  registeredFeatureProperties.clear()
  for (const [name, value] of entries) registeredFeatureProperties.set(name, value)
}
