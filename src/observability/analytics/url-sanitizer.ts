/**
 * @file Strips URLs down to what may leave the browser: scheme, host, path and
 * the allowlisted query keys. posthog-js copies the page URL and the referrer
 * into many properties, some of them nested (web-vitals attribution, exception
 * frames), so the sanitizer walks `properties`, `$set` and `$set_once`
 * recursively, to a fixed depth, and sanitises every absolute http(s) string
 * it finds rather than a fixed list of keys.
 */
import type { CaptureResult } from 'posthog-js'

/** A base for parsing relative URLs; never part of a result. */
const RELATIVE_BASE = 'http://relative.invalid'

/** An absolute http(s) URL, the shape every URL-valued posthog-js property takes. */
const ABSOLUTE_HTTP_URL = /^https?:\/\//i

/** The `href="…"` and `attr__href="…"` segments of an `$elements_chain`. */
const CHAIN_HREF = /(?<!\w)((?:attr__)?href=")((?:\\.|[^"\\])*)(")/g

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

/** How deep the walk goes; anything nested further is replaced, not passed through. */
export const MAX_SANITIZE_DEPTH = 8

/** What a value nested deeper than `MAX_SANITIZE_DEPTH` becomes. */
const DEPTH_LIMITED = '[depth limit]'

/** Replay snapshots are rrweb data, not event URLs; masking happens in the recorder. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set(['$snapshot_data'])

function sanitizeElements(elements: unknown[], allowlist: readonly string[]): unknown[] {
  return elements.map((element: unknown) => {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return element
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

function sanitizeValue(value: unknown, allowlist: readonly string[], depth: number): unknown {
  if (typeof value === 'string') {
    return ABSOLUTE_HTTP_URL.test(value) ? sanitizeUrl(value, allowlist) : value
  }
  if (typeof value !== 'object' || value === null) return value
  if (depth >= MAX_SANITIZE_DEPTH) return DEPTH_LIMITED
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitizeValue(item, allowlist, depth + 1))
  }
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SKIPPED_KEYS.has(key)) {
      result[key] = child
    } else if (key === '$elements' && Array.isArray(child)) {
      result[key] = sanitizeElements(child, allowlist)
    } else if (key === '$elements_chain' && typeof child === 'string') {
      result[key] = child.replace(
        CHAIN_HREF,
        (_match, before: string, href: string, after: string) =>
          `${before}${sanitizeUrl(href, allowlist)}${after}`
      )
    } else if (key === '$heatmap_data') {
      result[key] = sanitizeHeatmapData(child, allowlist)
    } else {
      result[key] = sanitizeValue(child, allowlist, depth + 1)
    }
  }
  return result
}

function sanitizeRecord(
  record: Record<string, unknown> | undefined,
  allowlist: readonly string[]
): Record<string, unknown> | undefined {
  if (!record) return record
  return sanitizeValue(record, allowlist, 0) as Record<string, unknown>
}

/**
 * The event with every URL it carries sanitised: each absolute http(s) string
 * anywhere in `properties`, `$set` and `$set_once`, to `MAX_SANITIZE_DEPTH`
 * levels (the current URL, the referrer, their `$initial_*` and
 * `$session_entry_*` copies, an external click URL, web-vitals navigation and
 * attribution URLs), the hrefs inside `$elements` and `$elements_chain`, and
 * the keys of `$heatmap_data`. Used as posthog-js's `before_send`.
 * @param event - The event posthog-js is about to send.
 * @param allowlist - Query keys that may survive.
 * @returns A sanitised copy; the input is not mutated.
 */
export function sanitizeEventUrls(
  event: CaptureResult,
  allowlist: readonly string[]
): CaptureResult {
  return {
    ...event,
    properties: sanitizeRecord(event.properties, allowlist) ?? {},
    ...(event.$set ? { $set: sanitizeRecord(event.$set, allowlist) } : {}),
    ...(event.$set_once ? { $set_once: sanitizeRecord(event.$set_once, allowlist) } : {}),
  }
}
