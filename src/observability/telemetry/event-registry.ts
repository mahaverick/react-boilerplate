/**
 * @file The typed registry of browser events. An event not listed here, or a
 * property outside its listed shape, fails to compile, and a property type
 * that admits a free string fails `REGISTRY_HAS_NO_FREE_STRINGS` below: a free
 * string is how a name, an address or a search term ends up in an event.
 */

import type { UpgradeSurface } from '@/types/billing.types'

declare const analyticsKeyBrand: unique symbol

/** A fixed, code-defined key (`onboarding_open_settings`), never user input. */
export type AnalyticsKey = string & { readonly [analyticsKeyBrand]: 'AnalyticsKey' }

/** Characters no fixed key needs, which an address, a sentence or a URL carries. */
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
  /** A list was sorted from a column header or the card sort menu: which list and column, and the direction, never a row. `sort` is `default` when the menu's "Default order" was chosen, which no column owns. */
  table_sorted: { table: AnalyticsKey; sort: AnalyticsKey; direction: 'asc' | 'desc' | 'default' }
  /** A list moved one page. */
  table_paged: { table: AnalyticsKey; direction: 'next' | 'prev' }
  /** A list was exported. */
  table_exported: { table: AnalyticsKey }
  /** The command palette was opened, by shortcut, button or store. */
  command_palette_opened: Record<never, never>
  /** An item was chosen in the palette: its kind, never its label or the typed term. */
  command_palette_action_run: { action: AnalyticsKey }
  /** The maintenance page (`full`) or the read-only banner was shown, once per maintenance period. */
  maintenance_page_viewed: { mode: 'full' | 'read_only' }
  /** A sign-in link was requested for an address (the API answered 202); the address is never sent. */
  sign_in_link_requested: Record<never, never>
  /** A sign-in finished: by an emailed link (also an invitation link), by Google or by a passkey. */
  sign_in_completed: { method: 'link' | 'google' | 'passkey' }
  /** The person dismissed the browser's passkey prompt, or it timed out, or the browser refused a prompt that opened without a click: in which ceremony, never which passkey. */
  passkey_prompt_cancelled: { ceremony: 'sign_in' | 'create' | 'confirm' }
  /** The public pricing page was shown, to a signed-in visitor or not. */
  pricing_viewed: { signed_in: boolean }
  /** The billing page was shown. */
  billing_page_viewed: Record<never, never>
  /** An upgrade prompt was shown, on which surface and for which entitlement. */
  upgrade_prompt_viewed: { surface: UpgradeSurface; key?: AnalyticsKey }
  /** An upgrade button was clicked, on which surface and for which entitlement. */
  upgrade_clicked: { surface: UpgradeSurface; key?: AnalyticsKey }
  /** The monthly or yearly toggle was chosen. */
  interval_selected: { interval: 'month' | 'year' }
  /** Razorpay Checkout opened, for which interval and purpose. */
  checkout_opened: {
    interval: 'month' | 'year'
    purpose: 'upgrade' | 'switch' | 'card_change'
  }
  /** Razorpay Checkout was closed without paying. */
  checkout_dismissed: { purpose: 'upgrade' | 'switch' | 'card_change' }
  /** A checkout step failed, and which. `confirm_failed` is the server refusing a taken payment's confirm. */
  checkout_failed: {
    failure_code: 'script_blocked' | 'payment_failed' | 'confirm_failed' | 'start_failed'
  }
  /** A payment was taken but not confirmed yet, so the flow waits for the webhook; `checkout_succeeded` follows if the page sees it land. */
  checkout_pending: { purpose: 'upgrade' | 'switch' | 'card_change' }
  /** A checkout finished and the API confirmed it. */
  checkout_succeeded: { purpose: 'upgrade' | 'switch' | 'card_change' }
  /** The cancel dialog was opened. */
  cancel_started: Record<never, never>
  /** Cancelling Paid was confirmed. */
  cancel_confirmed: Record<never, never>
  /** The trial explainer was shown. */
  trial_explainer_viewed: Record<never, never>
  /** The trial summary was shown. */
  trial_summary_viewed: Record<never, never>
  /** A banner was dismissed. */
  banner_dismissed: { banner: 'trial_ended' }
  /** A member asked the owners to upgrade, from which surface and for which entitlement. */
  upgrade_requested_ui: { surface: UpgradeSurface; key?: AnalyticsKey }
}

/** A registered event name. */
export type BrowserEvent = keyof BrowserEventProps

/**
 * The property keys, across the registry, whose type admits any string. The `-?`
 * reads an optional property by its declared type, so an optional `key?` does not
 * leave `undefined` in the union (which would fail the `never` check) and a free
 * string behind `?` is still caught.
 */
type FreeStringProperties<R> = {
  [E in keyof R]: {
    [P in keyof R[E]]-?: string extends R[E][P] ? `${E & string}.${P & string}` : never
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
