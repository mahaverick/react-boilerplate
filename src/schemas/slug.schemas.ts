/**
 * @file The shape of a tenant slug, mirroring the API's pattern. Its own file
 * so `_app`'s `?tenant` check, which ships in the entry chunk, does not pull
 * in the tenant form schemas.
 */

/** The shortest slug the API accepts. */
export const MIN_SLUG_LENGTH = 3
/** The longest slug the API accepts. */
export const MAX_SLUG_LENGTH = 100
/** Lowercase letters, digits and inner hyphens. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Whether `value` has a slug's shape: its length and pattern. Reserved slugs
 * pass; a slug no tenant may register is a form rule, not a shape.
 * @param value - The candidate.
 * @returns True for a slug-shaped string.
 */
export function isSlugShaped(value: string): boolean {
  return (
    value.length >= MIN_SLUG_LENGTH && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)
  )
}
