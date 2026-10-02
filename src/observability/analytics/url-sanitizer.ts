/**
 * @file Strips URLs down to what may leave the browser: scheme, host, path and
 * the allowlisted query keys. posthog-js copies the page URL and the referrer
 * into many properties, so the sanitizer walks every string that looks like a
 * URL rather than a fixed list of keys.
 */
import type { CaptureResult } from 'posthog-js'

/** A base for parsing relative URLs; never part of a result. */
const RELATIVE_BASE = 'http://relative.invalid'

/** An absolute http(s) URL, the shape every URL-valued posthog-js property takes. */
const ABSOLUTE_HTTP_URL = /^https?:\/\//i

/** The `href="…"` and `attr__href="…"` segments of an `$elements_chain`. */
const CHAIN_HREF = /(?<!\w)((?:attr__)?href=")([^"]*)(")/g

/**
 * The URL with only `allowlist` query keys kept, in their order, and no hash,
 * credentials or fragment. A relative URL stays relative. A non-http(s) URL
 * (`mailto:`, `tel:`) keeps only its scheme, since its address is the payload.
 * @param url - Absolute or relative.
 * @param allowlist - Query keys that may survive.
 * @returns The sanitised URL; an unparseable input loses everything after `?` or `#`.
 */
export function sanitizeUrl(url: string, allowlist: readonly string[]): string {
  let parsed: URL
  try {
    parsed = new URL(url, RELATIVE_BASE)
  } catch {
    return url.split(/[?#]/)[0] ?? ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return parsed.protocol

  const kept = new URLSearchParams()
  for (const [key, value] of parsed.searchParams) {
    if (allowlist.includes(key)) kept.append(key, value)
  }
  const query = kept.toString()
  const isRelative = parsed.origin === RELATIVE_BASE && !url.startsWith(RELATIVE_BASE)
  const prefix = isRelative ? '' : `${parsed.protocol}//${parsed.host}`
  return `${prefix}${parsed.pathname}${query === '' ? '' : `?${query}`}`
}

function sanitizeRecord(
  record: Record<string, unknown> | undefined,
  allowlist: readonly string[]
): Record<string, unknown> | undefined {
  if (!record) return record
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] =
      typeof value === 'string' && ABSOLUTE_HTTP_URL.test(value)
        ? sanitizeUrl(value, allowlist)
        : value
  }
  return result
}

function sanitizeElements(elements: unknown, allowlist: readonly string[]): unknown {
  if (!Array.isArray(elements)) return elements
  return elements.map((element: unknown) => {
    if (typeof element !== 'object' || element === null) return element
    const copy = { ...(element as Record<string, unknown>) }
    for (const key of ['attr__href', 'href']) {
      const value = copy[key]
      if (typeof value === 'string') copy[key] = sanitizeUrl(value, allowlist)
    }
    return copy
  })
}

function sanitizeHeatmapData(data: unknown, allowlist: readonly string[]): unknown {
  if (typeof data !== 'object' || data === null) return data
  const result: Record<string, unknown> = {}
  for (const [url, points] of Object.entries(data as Record<string, unknown>)) {
    result[sanitizeUrl(url, allowlist)] = points
  }
  return result
}

/**
 * The event with every URL it carries sanitised: each absolute http(s) string
 * in `properties`, `$set` and `$set_once` (the current URL, the referrer,
 * their `$initial_*` and `$session_entry_*` copies, an external click URL),
 * the hrefs inside `$elements` and `$elements_chain`, and the keys of
 * `$heatmap_data`. Used as posthog-js's `before_send`.
 * @param event - The event posthog-js is about to send.
 * @param allowlist - Query keys that may survive.
 * @returns A sanitised copy; the input is not mutated.
 */
export function sanitizeEventUrls(
  event: CaptureResult,
  allowlist: readonly string[]
): CaptureResult {
  const properties = sanitizeRecord(event.properties, allowlist) ?? {}
  if ('$elements' in properties) {
    properties.$elements = sanitizeElements(properties.$elements, allowlist)
  }
  if (typeof properties.$elements_chain === 'string') {
    properties.$elements_chain = properties.$elements_chain.replace(
      CHAIN_HREF,
      (_match, before: string, href: string, after: string) =>
        `${before}${sanitizeUrl(href, allowlist)}${after}`
    )
  }
  if ('$heatmap_data' in properties) {
    properties.$heatmap_data = sanitizeHeatmapData(properties.$heatmap_data, allowlist)
  }
  if (typeof properties.$set === 'object' && properties.$set !== null) {
    properties.$set = sanitizeRecord(properties.$set as Record<string, unknown>, allowlist)
  }
  if (typeof properties.$set_once === 'object' && properties.$set_once !== null) {
    properties.$set_once = sanitizeRecord(
      properties.$set_once as Record<string, unknown>,
      allowlist
    )
  }
  return {
    ...event,
    properties,
    ...(event.$set ? { $set: sanitizeRecord(event.$set, allowlist) } : {}),
    ...(event.$set_once ? { $set_once: sanitizeRecord(event.$set_once, allowlist) } : {}),
  }
}
