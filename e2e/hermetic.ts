import { test as base, expect } from '@playwright/test'

/**
 * Stamped on every fallback answer: an `/api` response without it came from
 * elsewhere. A test that fulfills an `/api` route itself sets it too.
 */
export const FALLBACK_HEADER = 'x-e2e-api-fallback'

/** A signed-out page's session bootstrap. The one call the fallback is there to answer. */
const BOOTSTRAP_REFRESH = 'POST /api/v1/auth/refresh'

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
 * Playwright's `test`, with no request able to reach the dev server's `/api`
 * proxy, and so none reaching whatever runs on :4040. An `/api` request that
 * would leave the browser, the MSW service worker's pass-throughs included,
 * gets express's 401 envelope instead. A route a test adds itself is
 * registered later, so Playwright consults it first; if it fulfills the
 * request, its response must carry `FALLBACK_HEADER` or teardown counts it
 * as an escape.
 *
 * At teardown the test fails if an `/api` response came from anywhere but
 * this fallback or the service worker, or if the fallback answered anything
 * but the bootstrap refresh: that is an endpoint the harness left unmocked.
 */
export const test = base.extend<{ apiFallback: ApiFallback }>({
  apiFallback: [
    async ({ context }, use) => {
      const answered: string[] = []
      const escaped: string[] = []
      await context.route(isApi, async (route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        answered.push(`${request.method()} ${pathname}`)
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
        answered.filter((call) => call !== BOOTSTRAP_REFRESH),
        'endpoints nothing mocked, answered by the fallback'
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
