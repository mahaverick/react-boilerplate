/**
 * @file The multi-frontend seam: a second frontend on another origin calling
 * this API through the container, not this SPA's own traffic, which is
 * same-origin and sends no preflight. It proves nginx forwards an `OPTIONS`
 * promptly off a `proxy_read_timeout 24h` location, and that `allowedHeaders`
 * lists `last-event-id`.
 */
import { expect, test } from '@playwright/test'
import { API_ORIGIN, apiIsReady } from '../live/helpers'

/** Where the container serves the app: `E2E_NGINX_ORIGIN`, default :8088. */
const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

/**
 * An origin in the API's allowlist (`WEB_URL`, `APEX_URL` or
 * `CORS_ALLOWED_ORIGINS` of the express under test), not `APP_ORIGIN`: a real
 * deployment serves the SPA and proxies `/api` on one origin, so `APP_ORIGIN`
 * is deliberately not listed. For an origin outside the allowlist the `cors`
 * package calls `next()` without answering the preflight, so the `OPTIONS` falls
 * through to `requireAuth` and gets a 401, not a 204. An allowed origin isolates
 * what the first test proves, that nginx passes an `OPTIONS` to express promptly
 * rather than holding it on the SSE location's `proxy_read_timeout 24h`, from
 * that allowlist decision.
 */
const ALLOWED_ORIGIN = process.env.E2E_ALLOWED_ORIGIN ?? 'http://localhost:5173'

test.skip(process.env.E2E_LIVE !== '1', 'needs the nginx container — run pnpm test:e2e:nginx')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
})

test('preflights the SSE stream promptly, rather than holding it open', async ({ request }) => {
  // That location has `proxy_buffering off` and `proxy_read_timeout 24h`, but a preflight must still be answered by express and returned at once.
  const started = Date.now()
  const response = await request.fetch(`${APP_ORIGIN}/api/v1/notifications/stream`, {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,last-event-id',
    },
  })

  expect(response.status()).toBe(204)
  expect(Date.now() - started).toBeLessThan(5000)
  const allowed = response.headers()['access-control-allow-headers']?.toLowerCase() ?? ''
  expect(allowed).toContain('last-event-id')
})

test('withholds the grant header from an origin that is not allowed', async ({ request }) => {
  const response = await request.fetch(`${APP_ORIGIN}/api/v1/auth/link/request`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' },
  })
  expect(response.headers()['access-control-allow-origin']).toBeUndefined()
})
