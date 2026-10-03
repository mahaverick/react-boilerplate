/**
 * @file The typed registry of browser events. An event not listed here, or a
 * property outside its listed shape, fails to compile, and a property type
 * that admits a free string fails `REGISTRY_HAS_NO_FREE_STRINGS` below: a free
 * string is how a name, an address or a search term ends up in an event.
 */

declare const analyticsKeyBrand: unique symbol

/** A fixed, code-defined key (`onboarding_open_settings`), never user input. */
export type AnalyticsKey = string & { readonly [analyticsKeyBrand]: 'AnalyticsKey' }

/** Characters no fixed key needs and an address, a sentence or a URL always has. */
type ForbiddenKeyCharacter = ' ' | '@' | '.' | '/' | ':' | '?' | '=' | '&' | '#'

/** `K` when it is a lowercase string literal free of forbidden characters, otherwise `never`. */
type KeyShape<K extends string> = string extends K
  ? never
  : K extends Lowercase<K>
    ? K extends `${string}${ForbiddenKeyCharacter}${string}`
      ? never
      : K
    : never

/**
 * Brands a string literal as an `AnalyticsKey`. A `string` variable, an
 * uppercase letter, a space, `@`, `.` or a URL character fails to compile.
 * @param key - A literal such as `'onboarding_open_settings'`.
 * @returns The same string, branded.
 */
export function analyticsKey<const K extends string>(key: K & KeyShape<K>): AnalyticsKey {
  return key as string as AnalyticsKey
}

/** Every browser event this app sends with `track`, and its properties. */
export interface BrowserEventProps {
  /** The active tenant changed from one tenant to another. */
  tenant_switched: Record<never, never>
  /** The in-progress Getting started checklist was shown. */
  onboarding_checklist_opened: { required_done: number; required_total: number }
  /** A call to action that leads into a feature was followed. */
  feature_cta_clicked: { cta: AnalyticsKey }
  /** A list's filters or search changed; which values were chosen is never sent. */
  table_filtered: { table: AnalyticsKey }
  /** A list was exported. */
  table_exported: { table: AnalyticsKey }
}

/** A registered event name. */
export type BrowserEvent = keyof BrowserEventProps

/** The property keys, across the registry, whose type admits any string. */
type FreeStringProperties<R> = {
  [E in keyof R]: {
    [P in keyof R[E]]: string extends R[E][P] ? `${E & string}.${P & string}` : never
  }[keyof R[E]]
}[keyof R]

/** Compiles only while no registered property admits a free string. */
export const REGISTRY_HAS_NO_FREE_STRINGS: [FreeStringProperties<BrowserEventProps>] extends [never]
  ? true
  : FreeStringProperties<BrowserEventProps> = true

/** `track`'s arguments after the name: none for an event with no properties. */
export type TrackArgs<E extends BrowserEvent> = keyof BrowserEventProps[E] extends never
  ? []
  : [props: BrowserEventProps[E]]
