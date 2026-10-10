/**
 * @file The cross-domain handoff: a website on another domain links into the
 * app with `?ph_did=<anonymous id>&ph_sid=<session id>`, so the visit keeps
 * the website's anonymous history. Accepted only from an allowlisted referrer,
 * only while this browser holds no identified person, and only once per id in
 * this browser; the parameters are stripped from the address bar either way.
 */

/** The two query parameters a website appends. */
const HANDOFF_PARAMS = ['ph_did', 'ph_sid'] as const

/** The localStorage key listing the handoff ids this browser has already accepted. */
export const CONSUMED_HANDOFFS_KEY = 'analytics_handoff_consumed'

/** How many accepted handoff ids are remembered; the oldest is forgotten past this. */
export const MAX_CONSUMED_HANDOFFS = 50

/** posthog-js mints anonymous and session ids as UUIDs (v7); anything else is not a handoff. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What `posthog.init` receives as `bootstrap`, when the handoff is accepted. */
export interface HandoffBootstrap {
  distinctID: string
  sessionID?: string
}

/** The handoff verdict: `bootstrap` is present only when it was accepted. */
export interface HandoffResult {
  bootstrap?: HandoffBootstrap
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Records `distinctID` as accepted, unless it already was. An id the app has
 * taken once may since have been merged into a signed-in person, so taking it
 * again would file the next visitor's activity under that person.
 * @returns False when the id was already used, or storage cannot be read or
 *   written: an id that cannot be recorded is refused.
 */
function consumeHandoff(distinctID: string): boolean {
  try {
    const stored = window.localStorage.getItem(CONSUMED_HANDOFFS_KEY)
    const parsed: unknown = stored === null ? [] : JSON.parse(stored)
    const consumed = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
    if (consumed.includes(distinctID)) return false
    const next = [...consumed, distinctID].slice(-MAX_CONSUMED_HANDOFFS)
    window.localStorage.setItem(CONSUMED_HANDOFFS_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/**
 * Decides whether this page load continues a website visit, and records an
 * accepted id so it is never accepted again in this browser.
 * @param location - The page's location; only `search` is read.
 * @param referrer - `document.referrer`, which the sending site's own Referrer-Policy controls.
 * @param allowlist - Origins allowed to hand off (the run-time `ANALYTICS_HANDOFF_ORIGINS`).
 * @param isIdentified - Whether this browser already holds an identified person.
 * @returns `bootstrap` when `ph_did` is a UUID, the referrer's origin is allowlisted,
 *   nobody is identified and the id was never accepted here before; `sessionID`
 *   only when `ph_sid` is a UUID too.
 */
export function readHandoff(
  location: Pick<Location, 'search'>,
  referrer: string,
  allowlist: readonly string[],
  isIdentified: boolean
): HandoffResult {
  const params = new URLSearchParams(location.search)
  const distinctID = params.get('ph_did')
  if (distinctID === null || !UUID_PATTERN.test(distinctID)) return {}
  if (isIdentified) return {}
  const origin = originOf(referrer)
  if (origin === null || !allowlist.includes(origin)) return {}
  if (!consumeHandoff(distinctID)) return {}
  const sessionID = params.get('ph_sid')
  return {
    bootstrap:
      sessionID !== null && UUID_PATTERN.test(sessionID)
        ? { distinctID, sessionID }
        : { distinctID },
  }
}

/**
 * Removes `ph_did` and `ph_sid` from the address bar with `history.replaceState`,
 * accepted or not, so a copied or bookmarked link never carries them on.
 */
export function stripHandoffParams(): void {
  const url = new URL(window.location.href)
  let isChanged = false
  for (const name of HANDOFF_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name)
      isChanged = true
    }
  }
  if (isChanged) {
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

/**
 * posthog-js's storage name: `ph_` plus its `persistence_name` option, else
 * `ph_<key>_posthog` with `+`, `/` and `=` escaped.
 */
function persistenceName(key: string, configuredName?: string): string {
  if (configuredName) return `ph_${configuredName}`
  return `ph_${key.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')}_posthog`
}

function userStateIn(serialized: string | null | undefined): unknown {
  if (!serialized) return undefined
  try {
    return (JSON.parse(serialized) as Record<string, unknown>).$user_state
  } catch {
    return undefined
  }
}

/**
 * Whether posthog-js's persisted state for `key` marks an identified person,
 * read before the SDK loads: `bootstrap` would otherwise replace that person's
 * distinct id with the handed-off anonymous one. posthog-js keeps `$user_state`
 * in both its localStorage entry and its cookie; either saying `identified` counts.
 * @param key - The project key.
 * @param configuredName - The `persistence_name` passed to posthog-js, if any.
 * @returns False when nothing is persisted or storage is unreadable.
 */
export function isPersistedIdentified(key: string, configuredName?: string): boolean {
  const name = persistenceName(key, configuredName)
  let stored: string | null
  try {
    stored = window.localStorage.getItem(name)
  } catch {
    stored = null
  }
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  let decoded: string | undefined
  try {
    decoded = cookie === undefined ? undefined : decodeURIComponent(cookie)
  } catch {
    decoded = undefined
  }
  return userStateIn(stored) === 'identified' || userStateIn(decoded) === 'identified'
}
