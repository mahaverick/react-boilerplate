/**
 * @file Email-domain helpers, mirroring the API's email.utilities.ts so a form
 * rejects locally an address whose domain the API would reject.
 */

/**
 * A lowercase dotted hostname: labels of 1-63 letters, digits and inner
 * hyphens, at most 253 characters in all.
 */
const EMAIL_DOMAIN_PATTERN =
  /^(?=.{1,253}$)[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/

/**
 * The domain of an email address when it is a lowercase dotted hostname.
 * @param email - The address.
 * @returns The lowercased domain after the last `@`, or undefined when there is none or it is not a dotted hostname.
 */
export function hostnameDomain(email: string): string | undefined {
  const at = email.lastIndexOf('@')
  if (at === -1) return undefined
  const domain = email.slice(at + 1).toLowerCase()
  return EMAIL_DOMAIN_PATTERN.test(domain) ? domain : undefined
}
