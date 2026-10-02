/**
 * @file Session replay's attribute mask. Replay records every attribute of
 * every element, and the ones named here are where a person's name or address
 * ends up: `aria-label="Remove Jane Doe"`, `title`, `alt`, `placeholder`,
 * `data-*`, a `mailto:` link, or an href whose query carries a token.
 */

/** What a masked attribute's value is replaced with. */
export const MASKED_ATTRIBUTE_VALUE = '***'

const MASKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-label',
  'title',
  'alt',
  'placeholder',
])

/**
 * posthog-js's `session_recording.maskAttributeFn`.
 * @param name - The attribute's name, as rrweb serialises it.
 * @param value - Its value.
 * @returns `***` for an attribute that can hold PII, otherwise `value` unchanged.
 */
export function maskReplayAttribute(name: string, value: string): string {
  const attribute = name.toLowerCase()
  if (MASKED_ATTRIBUTES.has(attribute) || attribute.startsWith('data-')) {
    return MASKED_ATTRIBUTE_VALUE
  }
  if (attribute === 'href' && (/^\s*mailto:/i.test(value) || value.includes('?'))) {
    return MASKED_ATTRIBUTE_VALUE
  }
  return value
}
