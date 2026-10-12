// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * nginx.conf's error-log pins, read from the template the image ships. nginx
 * writes the request line, query string included, into every upstream error, at
 * the `error` level, so only a location's own `error_log … crit` keeps a query
 * out of the log. docker/check-image.sh proves the callback's in a running image.
 */

const CONF = readFileSync(path.resolve(import.meta.dirname, '../../../nginx.conf'), 'utf8')

/** The body of the location opened by `opening`, up to its closing brace; it holds no nested block. */
function locationBody(opening: string): string {
  const start = CONF.indexOf(`${opening} {`)
  expect(start, `${opening} exists`).toBeGreaterThanOrEqual(0)
  const end = CONF.indexOf('\n  }', start)
  return CONF.slice(start, end)
}

describe('nginx.conf', () => {
  it.each(['location = /api/v1/auth/google/callback', 'location /api/v1/notifications/stream'])(
    '%s logs upstream errors only at crit and proxies to the API',
    (opening) => {
      const body = locationBody(opening)
      expect(body).toMatch(/^\s*error_log\s+\S+\s+crit;/m)
      expect(body).toContain('proxy_pass ${API_UPSTREAM};')
    }
  )
})
