/**
 * @file The posthog-js init options, built by one pure function so every
 * privacy setting is asserted in a unit test rather than read off a live SDK.
 */
import type { CapturedNetworkRequest, PostHogConfig, PostHogInterface } from 'posthog-js'
import type { HandoffBootstrap } from './handoff'
import { maskReplayAttribute } from './mask-attribute'
import { sanitizeEventUrls, sanitizeUrl } from './url-sanitizer'

/**
 * The newest `defaults` posthog-js 1.435.6 knows: history-API pageviews and
 * pageleaves, hash-stripped URLs, and `captureJsonLd: true`, which the
 * session-recording options below turn back off.
 */
export const POSTHOG_DEFAULTS = '2026-08-30'

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
  bootstrap?: HandoffBootstrap
  /** Runs once the SDK has loaded, before its first `$pageview`. */
  onLoaded: (instance: PostHogInterface) => void
}

/**
 * The init options. `required` adds `cookieless_mode: 'on_reject'`: until the
 * banner is answered nothing is captured, and a refusal leaves only
 * cookieless, server-hashed counts. posthog-js 1.435 has no `cookie_domain`
 * option; `cross_subdomain_cookie` finds the registrable domain itself.
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
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [...CUSTOM_PERSONAL_DATA_PROPERTIES],
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: true,
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
    before_send: (event) => (event === null ? null : sanitizeEventUrls(event, allowlist)),
    ...(input.consentMode === 'required' ? { cookieless_mode: 'on_reject' as const } : {}),
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
    loaded: input.onLoaded,
  }
}
