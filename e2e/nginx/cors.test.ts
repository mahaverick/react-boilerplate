import { expect, test } from '@playwright/test'
import { API_ORIGIN, apiIsReady } from '../live/helpers'

/**
 * A test of the MULTI-FRONTEND SEAM — the deployment where a second frontend
 * on another origin calls this API — not of this SPA's own traffic, which is
 * same-origin (CLAUDE.md, "The API prefix is fixed and relative") and never
 * sends a preflight at all. See `ALLOWED_ORIGIN`'s own comment below for why
 * `Origin: http://localhost:5173` is the right choice for that anyway: it
 * proves nginx forwards an `OPTIONS` promptly off a `proxy_read_timeout 24h`
 * location, and that `allowedHeaders` really lists `last-event-id`.
 */
const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

/**
 * The origin the API's own allowlist actually grants — `WEB_URL` in
 * `express-boilerplate/.env` (`origin.utilities.ts`'s `isAllowedOrigin`),
 * not `APP_ORIGIN` above.
 *
 * Measured, not assumed: `APP_ORIGIN` (the container this suite drives, on
 * :8088) is deliberately NOT in that allowlist — a real deployment serves
 * the SPA and proxies `/api` on the SAME origin (CLAUDE.md, "The API prefix
 * is fixed and relative"), so the browser never sends a cross-origin
 * request to itself and `APP_ORIGIN` never needs listing. Sending
 * `Origin: APP_ORIGIN` therefore does not exercise "an allowed
 * cross-origin caller" at all; it exercises "an origin the allowlist
 * rejects", the same case the second test below covers: the `cors`
 * package's own origin check (`cors.config.ts`) declines to answer the
 * preflight at all when the origin is not allowed — it calls `next()`
 * rather than sending a response — so the OPTIONS request falls through
 * to `requireAuth` on this route, which rejects it with 401, not 204 —
 * confirmed against this exact container. Using the
 * allowlisted origin instead is what isolates the property this test
 * exists to prove — nginx passes an OPTIONS through to Express promptly
 * rather than holding it on the SSE location's `proxy_read_timeout 24h` —
 * from an unrelated allowlist decision.
 */
const ALLOWED_ORIGIN = process.env.E2E_ALLOWED_ORIGIN ?? 'http://localhost:5173'

test.skip(process.env.E2E_LIVE !== '1', 'needs the nginx container — run pnpm test:e2e:nginx')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
})

test('preflights the SSE stream promptly, rather than holding it open', async ({ request }) => {
  // That location carries `proxy_buffering off` and `proxy_read_timeout 24h`.
  // A preflight must still be answered by Express and returned at once.
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
  const response = await request.fetch(`${APP_ORIGIN}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  })
  expect(response.headers()['access-control-allow-origin']).toBeUndefined()
})
