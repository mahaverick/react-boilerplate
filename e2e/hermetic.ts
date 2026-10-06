import { test as base, expect } from '@playwright/test'

/**
 * Stamped on every fallback answer: an `/api` response without it came from
 * elsewhere. A test that fulfills an `/api` route itself sets it too.
 */
export const FALLBACK_HEADER = 'x-e2e-api-fallback'

/** A signed-out page's session bootstrap. One of the two calls the fallback is there to answer. */
const BOOTSTRAP_REFRESH = 'POST /api/v1/auth/refresh'

/** The root route's maintenance read, which every page makes and express answers without a session. */
const MAINTENANCE_STATUS = 'GET /api/v1/status/maintenance'

/** Express's answer to `MAINTENANCE_STATUS` while maintenance is off. */
const MAINTENANCE_OFF = {
  success: true,
  message: 'Maintenance status retrieved.',
  statusCode: 200,
  data: { mode: 'off', message: null, since: null },
}

function isApi(url: URL): boolean {
  return url.pathname.startsWith('/api/')
}

/** Express's own 401 envelope for a caller with no session. */
function unauthorized(pathname: string) {
  return {
    success: false,
    message:
      pathname === '/api/v1/auth/refresh'
        ? 'Missing refresh token'
        : 'Missing or malformed Authorization header',
    statusCode: 401,
    requestId: 'e2e-api-fallback',
  }
}

type ApiFallback = {
  /** `METHOD /path` of every request the fallback answered, in order. */
  answered: string[]
}

/**
 * Playwright's `test`, extended to answer every `/api` request that would
 * leave the browser — the MSW service worker's pass-throughs included —
 * with express's 401 envelope, except the maintenance status read, which gets
 * express's `off` answer. A route a test adds itself is registered
 * later, so Playwright consults it first; if it lets the request through
 * with `route.continue()`, that reaches the dev server's proxy and is only
 * caught at teardown, not blocked outright. A fulfilled response must carry
 * `FALLBACK_HEADER` or teardown counts it as an escape. The `request`
 * fixture's own calls are never routed or observed here.
 *
 * At teardown the test fails if an `/api` response came from anywhere but
 * this fallback or the service worker, or if the fallback answered anything
 * but the bootstrap refresh and the maintenance read: that is an endpoint the
 * harness left unmocked.
 */
export const test = base.extend<{ apiFallback: ApiFallback }>({
  apiFallback: [
    async ({ context }, use) => {
      const answered: string[] = []
      const escaped: string[] = []
      await context.route(isApi, async (route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        const call = `${request.method()} ${pathname}`
        answered.push(call)
        if (call === MAINTENANCE_STATUS) {
          await route.fulfill({
            status: 200,
            headers: { [FALLBACK_HEADER]: '1', 'Maintenance-Mode': 'off' },
            json: MAINTENANCE_OFF,
          })
          return
        }
        await route.fulfill({
          status: 401,
          headers: { [FALLBACK_HEADER]: '1' },
          json: unauthorized(pathname),
        })
      })
      context.on('response', (response) => {
        const url = new URL(response.url())
        if (!isApi(url) || response.fromServiceWorker()) return
        if (response.headers()[FALLBACK_HEADER] === '1') return
        escaped.push(`${response.request().method()} ${url.pathname} → ${response.status()}`)
      })

      await use({ answered })

      expect(escaped, '/api responses that came from the dev server proxy').toEqual([])
      expect(
        answered.filter((call) => call !== BOOTSTRAP_REFRESH && call !== MAINTENANCE_STATUS),
        'endpoints nothing mocked, answered by the fallback'
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
