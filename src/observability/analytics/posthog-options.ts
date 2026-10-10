/**
 * @file The posthog-js init options, built by one pure function so every
 * privacy setting is asserted in a unit test rather than read off a live SDK.
 */
import type {
  CapturedNetworkRequest,
  CaptureResult,
  PostHogConfig,
  PostHogInterface,
} from 'posthog-js'
import type { HandoffBootstrap } from './handoff'
import { maskReplayAttribute } from './mask-attribute'
import { sanitizeEventUrls, sanitizeUrl } from './url-sanitizer'

/**
 * The newest `defaults` posthog-js 1.435.6 knows: history-API pageviews and
 * pageleaves, hash-stripped URLs, and `captureJsonLd: true`, which the
 * session-recording options below turn back off. Its automatic pageviews are
 * turned off (`capture_pageview`): the router captures each one once the
 * route has resolved, so a pageview never precedes the state it describes.
 */
const POSTHOG_DEFAULTS = '2026-08-30'

/**
 * The class `<Pii>` puts on every rendered name, address and initial.
 * `ph-sensitive` keeps the text out of a clicked ancestor's `$el_text`;
 * `ph-mask` (with `MASK_TEXT_SELECTOR`) masks it in replay.
 */
export const PII_CLASS_NAME = 'ph-sensitive ph-mask'

/** Replay masks the text of any element matching this, or inside one. */
export const MASK_TEXT_SELECTOR = '.ph-mask, .ph-sensitive'

/**
 * Query keys posthog-js masks in URLs on its own, in addition to the
 * allowlist sanitizer: a second layer for the keys that carry credentials,
 * addresses or redirect targets in this app, plus the handoff's two.
 */
export const CUSTOM_PERSONAL_DATA_PROPERTIES: readonly string[] = [
  'token',
  'email',
  'redirect',
  'invitation',
  'q',
  'search',
  'ph_did',
  'ph_sid',
]

/** Everything `buildPosthogOptions` needs from outside. */
export interface PosthogOptionsInput {
  /** Absolute: posthog-js calls `new URL` on it. */
  apiHost: string
  uiHost: string
  consentMode: 'opt_out' | 'required'
  urlAllowlist: readonly string[]
  /** posthog-js `persistence_name`; unset keeps its default storage key. */
  persistenceName?: string | undefined
  /** posthog-js `cross_subdomain_cookie`. */
  crossSubdomainCookie: boolean
  bootstrap?: HandoffBootstrap
  /**
   * Runs on every event before it is sanitised and sent, and returns the
   * event to send (possibly repaired) or null to drop it. The facade uses it
   * to refuse events a sibling tab or website re-attributed to another
   * person, and to put back the super properties and group a sibling's reset
   * cleared.
   */
  guardEvent?: (event: CaptureResult) => CaptureResult | null
  /** Runs once the SDK has loaded, before it sends any event. */
  onLoaded: (instance: PostHogInterface) => void
}

/**
 * The init options. posthog-js does no flag work
 * (`advanced_disable_feature_flags`): express evaluates every flag, and
 * `advanced_disable_flags` is not used because it also stops remote config,
 * so session replay would never start. `required` adds
 * `cookieless_mode: 'on_reject'`: until the
 * banner is answered nothing is captured, and a refusal leaves only
 * cookieless, server-hashed counts. posthog-js 1.435 has no `cookie_domain`
 * option; `cross_subdomain_cookie` finds the registrable domain itself.
 * `persistence_name` and `cross_subdomain_cookie` decide whether this app
 * shares its browser identity with a sibling app on the same project key.
 * @param input - See `PosthogOptionsInput`.
 * @returns A partial `PostHogConfig` for `posthog.init`.
 */
export function buildPosthogOptions(input: PosthogOptionsInput): Partial<PostHogConfig> {
  const allowlist = input.urlAllowlist
  return {
    api_host: input.apiHost,
    ui_host: input.uiHost,
    defaults: POSTHOG_DEFAULTS,
    autocapture: true,
    capture_pageview: false,
    capture_pageleave: true,
    advanced_disable_feature_flags: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [...CUSTOM_PERSONAL_DATA_PROPERTIES],
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: input.crossSubdomainCookie,
    ...(input.persistenceName ? { persistence_name: input.persistenceName } : {}),
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: MASK_TEXT_SELECTOR,
      maskAttributeFn: maskReplayAttribute,
      maskCapturedNetworkRequestFn: (request: CapturedNetworkRequest) => ({
        ...request,
        name: sanitizeUrl(request.name, allowlist),
      }),
      captureJsonLd: false,
      recordHeaders: false,
      recordBody: false,
    },
    before_send: (event) => {
      if (event === null) return null
      const guarded = input.guardEvent ? input.guardEvent(event) : event
      return guarded === null ? null : sanitizeEventUrls(guarded, allowlist)
    },
    ...(input.consentMode === 'required' ? { cookieless_mode: 'on_reject' as const } : {}),
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
    loaded: input.onLoaded,
  }
}
