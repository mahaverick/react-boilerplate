/**
 * @file The hooks pages read flags with. Each reads the current page's scope
 * (`useFlagScope`) and shows the fallback until the server's values arrive or
 * when they fail. An experiment flag's value, once it came from the server,
 * is reported as an exposure after the commit that used it.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { reportExposure } from './exposure'
import { flagsQueryOptions } from './flag-query'
import { useFlagScope } from './flag-scope'
import type {
  BooleanClientFlagKey,
  ClientFlagKey,
  ClientFlagValue,
  ClientFlagValues,
  ClientVariantOf,
  MultivariateClientFlagKey,
} from './flag-types'
import { clientFlagFallback, fallbackFlags, isExperimentFlag } from './flag-values'
import { syncFeatureProperties } from './register'

/** One shared fallback record, so readers see a stable object while nothing has loaded. */
let fallbacks: ClientFlagValues | null = null

function sharedFallbacks(): ClientFlagValues {
  fallbacks ??= fallbackFlags()
  return fallbacks
}

/**
 * Every flag's value in the current scope.
 * @returns The server's values, or every fallback while loading or after a failure.
 */
export function useFlagValues(): ClientFlagValues {
  const scope = useFlagScope()
  const { data } = useQuery(flagsQueryOptions(scope))
  return data ?? sharedFallbacks()
}

/**
 * One flag's value in the current scope, reporting an experiment's exposure
 * once the value came from the server.
 * @param key - A flag this app reads.
 * @returns Its value, or its fallback while loading or after a failure.
 */
export function useFlagValue<K extends ClientFlagKey>(key: K): ClientFlagValue<K> {
  const scope = useFlagScope()
  const { data } = useQuery(flagsQueryOptions(scope))
  const isLoaded = data !== undefined
  const value: ClientFlagValue<K> = data ? data[key] : clientFlagFallback(key)

  useEffect(() => {
    if (isLoaded && isExperimentFlag(key)) reportExposure(scope, key, value)
  }, [isLoaded, key, scope, value])

  return value
}

/**
 * A boolean flag.
 * @param key - A boolean flag this app reads.
 * @returns True only when the server says so.
 */
export function useFlag(key: BooleanClientFlagKey): boolean {
  return useFlagValue(key) === true
}

/**
 * A multivariate flag's variant.
 * @param key - A multivariate flag this app reads.
 * @returns Its variant, or its fallback variant while loading or after a failure.
 */
export function useVariant<K extends MultivariateClientFlagKey>(key: K): ClientVariantOf<K> {
  return useFlagValue(key) as ClientVariantOf<K>
}

/**
 * Keeps the `$feature/*` super properties on the current scope's values.
 * Mount it once, in the authenticated layout: registering from the query
 * instead would also register a hovered link's preloaded scope.
 */
export function useFeaturePropertiesSync(): void {
  const scope = useFlagScope()
  const { data } = useQuery(flagsQueryOptions(scope))
  useEffect(() => {
    syncFeatureProperties(data ?? null)
  }, [data])
}

/** Test-only: forget the shared fallback record. */
export function resetFlagHooksForTests(): void {
  fallbacks = null
}
