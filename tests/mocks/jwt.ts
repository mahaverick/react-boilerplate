/**
 * @file A JWT-shaped access token for tests that read its claims. This app only
 * decodes the payload (the API verifies the signature), so the signature here
 * is a placeholder.
 */

/** One JWT segment: `value` as JSON, base64url without padding. */
function segment(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * An unsigned token whose payload is `claims`.
 * @param claims - The payload, such as `{ auth_time: 1_760_000_000 }`.
 * @returns `header.payload.signature`.
 */
export function testJwt(claims: Record<string, unknown>): string {
  return `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment(claims)}.signature`
}

/** A token whose `auth_time` is now, as the API mints after a confirmation. */
export function freshlyConfirmedToken(): string {
  return testJwt({ sub: 'test-user', auth_time: Math.floor(Date.now() / 1_000) })
}
