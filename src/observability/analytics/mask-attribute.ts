/**
 * @file Session replay's attribute mask. Replay records every attribute of
 * every element, and the ones named here are where a person's name or address
 * ends up: `aria-label="Remove Jane Doe"`, `title`, `alt`, `placeholder`,
 * `data-*`, an iframe's `srcdoc` (a whole HTML document), a `mailto:` or `tel:` link, or an href, `src` or `srcset` whose
 * query string can carry a token.
 */

/** What a masked attribute's value is replaced with. */
const MASKED_ATTRIBUTE_VALUE = '***'

const MASKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-label',
  'title',
  'alt',
  'placeholder',
  'srcdoc',
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
  if (attribute === 'href' && (/^\s*(?:mailto|tel):/i.test(value) || value.includes('?'))) {
    return MASKED_ATTRIBUTE_VALUE
  }
  if ((attribute === 'src' || attribute === 'srcset') && value.includes('?')) {
    return MASKED_ATTRIBUTE_VALUE
  }
  return value
}
