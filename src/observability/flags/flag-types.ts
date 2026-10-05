/**
 * @file The client flag types, derived from this app's `CLIENT_FLAGS`
 * (`flag-keys.ts`), so a key or variant the registry slice does not declare
 * is a typecheck failure wherever it is used.
 */
import type { CLIENT_FLAGS } from './flag-keys'

/**
 * One entry of the express flag registry, as a client mirrors it: its kind,
 * its variants, the value used whenever the server's answer is missing, and
 * whether it is an experiment whose exposure the browser reports.
 */
export type ClientFlagDefinition =
  | { readonly kind: 'boolean'; readonly fallback: false; readonly experiment: false }
  | {
      readonly kind: 'multivariate'
      readonly variants: readonly [string, ...string[]]
      readonly fallback: string
      readonly experiment: boolean
    }

type ClientFlags = typeof CLIENT_FLAGS

/** A flag this app reads. */
export type ClientFlagKey = Extract<keyof ClientFlags, string>

/** A flag whose value is true or false. */
export type BooleanClientFlagKey = {
  [K in ClientFlagKey]: ClientFlags[K] extends { kind: 'boolean' } ? K : never
}[ClientFlagKey]

/** A flag whose value is one of its variants. */
export type MultivariateClientFlagKey = {
  [K in ClientFlagKey]: ClientFlags[K] extends { kind: 'multivariate' } ? K : never
}[ClientFlagKey]

/** The variants of a multivariate flag, as a union of their names. */
export type ClientVariantOf<K extends MultivariateClientFlagKey> = ClientFlags[K] extends {
  variants: readonly (infer V extends string)[]
}
  ? V
  : never

/** The value a flag takes: a boolean, or one of its variants. */
export type ClientFlagValue<K extends ClientFlagKey> = K extends MultivariateClientFlagKey
  ? ClientVariantOf<K>
  : boolean

/** Every flag this app reads, with its value. */
export type ClientFlagValues = { readonly [K in ClientFlagKey]: ClientFlagValue<K> }
