/**
 * @file Pure helpers over `CLIENT_FLAGS`: the keys and each flag's fallback,
 * the server's answer checked against them, and a list filtered by flag.
 */
import { CLIENT_FLAGS } from './flag-keys'
import type {
  BooleanClientFlagKey,
  ClientFlagDefinition,
  ClientFlagKey,
  ClientFlagValue,
  ClientFlagValues,
} from './flag-types'

/** `CLIENT_FLAGS` read by a plain string key, which an empty slice still allows. */
const definitions: Readonly<Record<string, ClientFlagDefinition>> = CLIENT_FLAGS

/** A declared flag's definition; a key outside `CLIENT_FLAGS` is a programming error. */
function definitionOf(key: string): ClientFlagDefinition {
  const definition = definitions[key]
  if (!definition) throw new Error(`Unknown client flag "${key}"`)
  return definition
}

/**
 * A value as a type the checker cannot see it already has. Generic, because
 * an app with an empty slice types the values as `{}`, where a direct cast is
 * one the linter calls unnecessary.
 */
function typedAs<T>(value: unknown): T {
  return value as T
}

/**
 * Every flag this app reads.
 * @returns The keys, in declaration order.
 */
export function clientFlagKeys(): ClientFlagKey[] {
  return Object.keys(definitions) as ClientFlagKey[]
}

/**
 * The value a flag takes when the server's answer is missing, failed or not
 * loaded yet: false, or the flag's first variant.
 * @param key - A flag this app reads.
 * @returns Its fallback.
 */
export function clientFlagFallback<K extends ClientFlagKey>(key: K): ClientFlagValue<K> {
  return definitionOf(key).fallback as ClientFlagValue<K>
}

/**
 * Whether a flag is an experiment, whose exposure the browser reports.
 * @param key - A flag this app reads.
 * @returns True for an experiment.
 */
export function isExperimentFlag(key: ClientFlagKey): boolean {
  return definitions[key]?.experiment === true
}

/**
 * Every flag at its fallback.
 * @returns A fresh record.
 */
export function fallbackFlags(): ClientFlagValues {
  const values: Record<string, boolean | string> = {}
  for (const key of Object.keys(definitions)) values[key] = definitionOf(key).fallback
  return typedAs<ClientFlagValues>(values)
}

function isValidValue(definition: ClientFlagDefinition, value: unknown): value is boolean | string {
  if (definition.kind === 'boolean') return typeof value === 'boolean'
  return typeof value === 'string' && definition.variants.includes(value)
}

/**
 * The server's flag values checked against `CLIENT_FLAGS`: a key this app
 * does not declare is dropped, and a missing key or a value of the wrong kind
 * or outside the flag's variants takes the fallback. In development each of
 * those logs a warning naming the key.
 * @param raw - The `flags` object of a flags response.
 * @returns A value for every flag this app reads.
 */
export function normalizeFlags(raw: Readonly<Record<string, unknown>>): ClientFlagValues {
  const values: Record<string, boolean | string> = {}
  for (const key of Object.keys(definitions)) {
    const definition = definitionOf(key)
    const value = raw[key]
    if (isValidValue(definition, value)) {
      values[key] = value
      continue
    }
    values[key] = definition.fallback
    if (import.meta.env.DEV) {
      console.warn(
        `Flag "${key}" is missing or invalid in the server's answer; using its fallback.`
      )
    }
  }
  if (import.meta.env.DEV) {
    for (const key of Object.keys(raw)) {
      if (!(key in definitions)) {
        console.warn(`Flag "${key}" is not in this app's CLIENT_FLAGS; ignoring it.`)
      }
    }
  }
  return typedAs<ClientFlagValues>(values)
}

/**
 * The items whose flag is on, and every item without one: a nav entry or a
 * tab with `flag` set is hidden while that flag is false.
 * @param items - Entries that may name a boolean flag.
 * @param values - The current flag values.
 * @returns The visible entries, in order.
 */
export function filterByFlag<T extends { flag?: BooleanClientFlagKey }>(
  items: readonly T[],
  values: ClientFlagValues
): T[] {
  return items.filter((item) => item.flag === undefined || values[item.flag] === true)
}
