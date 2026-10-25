// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

/**
 * nginx.conf's error-log and security-header pins, read from the template the
 * image ships. nginx writes the request line, query string included, into every
 * upstream error, at the `error` level, so only a location's own
 * `error_log … crit` keeps a query out of the log. docker/check-image.sh proves
 * the callback's in a running image, and the headers on every response.
 */

const CONF = readFileSync(path.resolve(import.meta.dirname, '../../../nginx.conf'), 'utf8')

const CALLBACK = 'location ~* ^/api/v1/auth/google/callback/?$'
const STREAM = 'location /api/v1/notifications/stream'
const API = 'location /api/'

/** The body of the location opened by `opening`, up to its closing brace; it holds no nested block. */
function locationBody(opening: string): string {
  const start = CONF.indexOf(`${opening} {`)
  expect(start, `${opening} exists`).toBeGreaterThanOrEqual(0)
  const end = CONF.indexOf('\n  }', start)
  expect(end, `${opening} closes`).toBeGreaterThan(start)
  return CONF.slice(start, end)
}

/** The directive lines of a location body, without comments, blank lines or `error_log`. */
function proxyDirectives(body: string): string[] {
  return body
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('error_log '))
}

/**
 * The value a security-header map sends when the upstream response carries none
 * of its own: its `''` entry, without the quotes.
 */
function headerDefault(variable: string): string {
  const match = new RegExp(String.raw`^map \S+ \$${variable} \{\n\s*''\s+(['"])(.*)\1;$`, 'm').exec(
    CONF
  )
  expect(match, `map for $${variable} exists`).not.toBeNull()
  return match?.[2] ?? ''
}

describe('nginx.conf', () => {
  it.each([
    [
      'content_security_policy',
      "default-src 'self'; script-src 'self' https://checkout.razorpay.com https://cdn.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ],
    [
      'permissions_policy',
      'camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=()',
    ],
    ['cross_origin_opener_policy', 'same-origin-allow-popups'],
    ['referrer_policy', 'no-referrer'],
  ])('sends $%s as Razorpay Checkout needs it', (variable, value) => {
    expect(headerDefault(variable)).toBe(value)
  })

  it.each([CALLBACK, STREAM])(
    '%s logs upstream errors only at crit and proxies to the API',
    (opening) => {
      const body = locationBody(opening)
      expect(body).toMatch(/^\s*error_log\s+\S+\s+crit;/m)
      expect(body).toContain('proxy_pass ${API_UPSTREAM};')
    }
  )

  it('proxies the callback exactly as location /api/ does', () => {
    const api = proxyDirectives(locationBody(API))
    expect(api).toContain('proxy_pass ${API_UPSTREAM};')
    expect(proxyDirectives(locationBody(CALLBACK))).toEqual(api)
  })
})
