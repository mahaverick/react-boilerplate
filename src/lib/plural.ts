/**
 * @file Counted nouns from a plural label, such as the catalog's "Members".
 * The catalog serves one plural label per limit, so the singular is derived.
 */

/**
 * A plural noun's singular: "members" → "member", "categories" → "category",
 * "boxes" → "box", "houses" → "house". A word that does not end in "s"
 * comes back as it is.
 * @param plural - A plural noun, in the case it should keep.
 */
function singularOf(plural: string): string {
  if (/ies$/i.test(plural)) return `${plural.slice(0, -3)}y`
  if (/(?:x|ss|ch|sh)es$/i.test(plural)) return plural.slice(0, -2)
  if (/s$/i.test(plural)) return plural.slice(0, -1)
  return plural
}

/**
 * The noun to put after a count: the singular for exactly one, else the
 * plural. In "1 of 3 members" the noun follows the 3.
 * @param count - The number the noun follows.
 * @param plural - The plural noun, such as "members".
 */
export function nounFor(count: number, plural: string): string {
  return count === 1 ? singularOf(plural) : plural
}

/**
 * A count and its noun: "1 member", "7 members", "0 members".
 * @param count - How many.
 * @param plural - The plural noun, such as "members".
 */
export function countOf(count: number, plural: string): string {
  return `${String(count)} ${nounFor(count, plural)}`
}
