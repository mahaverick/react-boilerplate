/**
 * @file A W3C `traceparent` header per API call, so the server's span (and the
 * analytics events it writes) share a trace id the browser chose. There is no
 * browser tracing SDK: the ids are random and the flags say "sampled".
 */

/** `length` random bytes. */
type RandomBytes = (length: number) => Uint8Array

const cryptoBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))

function randomHex(length: number, randomBytes: RandomBytes): string {
  let hex: string
  // The W3C spec makes an all-zero trace or parent id invalid, so one is drawn again.
  do {
    hex = Array.from(randomBytes(length), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } while (/^0+$/.test(hex))
  return hex
}

/**
 * A fresh `traceparent`: `00-<32 hex trace id>-<16 hex parent id>-01`.
 * @param randomBytes - The byte source; `crypto.getRandomValues` by default.
 * @returns The header value.
 */
export function createTraceparent(randomBytes: RandomBytes = cryptoBytes): string {
  return `00-${randomHex(16, randomBytes)}-${randomHex(8, randomBytes)}-01`
}
