import { test as base, expect, type Page, type Request } from '@playwright/test'

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

/** The sign-in page's public passkey config read, made by every signed-out page that shows sign-in. */
const PASSKEY_CONFIG = 'GET /api/v1/auth/passkeys/config'

/** The config answer for an API with passkeys off, so a page outside the harness shows no passkey UI. */
const PASSKEYS_OFF = {
  success: true,
  message: 'Passkey config retrieved.',
  statusCode: 200,
  data: { mode: 'off', rpId: '' },
}

/** Whether a request URL is an `/api` call, which the fallback answers. */
function isApi(url: URL): boolean {
  return url.pathname.startsWith('/api/')
}

/** Express's own 401 envelope for a caller with no session. */
function unauthorized(pathname: string) {
  return {
    success: false,
    message:
      pathname === '/api/v1/auth/refresh'
        ? "You're signed out. Sign in to continue."
        : 'Sign in to continue.',
    statusCode: 401,
    requestId: 'e2e-api-fallback',
  }
}

/** What the auto-used `apiFallback` fixture hands a test. */
type ApiFallback = {
  /** `METHOD /path` of every request the fallback answered, in order. */
  answered: string[]
  /** `METHOD /path` of every call aborted during a navigation while another page was open. */
  swallowed: string[]
}

/**
 * Playwright's `test`, extended to answer every `/api` request that would
 * leave the browser, the MSW service worker's pass-throughs included, with
 * express's 401 envelope, except the maintenance status read and the passkey
 * config read, which get express's `off` answer. A route a test adds itself is registered later, so
 * Playwright consults it first; if it lets a request through with
 * `route.continue()`, that reaches the dev server's proxy and is caught only at
 * teardown. A fulfilled response must carry `FALLBACK_HEADER` or teardown
 * counts it as an escape. The `request` fixture's own calls are never routed or
 * observed here.
 *
 * At teardown the test fails if an `/api` response came from anywhere but this
 * fallback or the service worker, or if the fallback answered anything but the
 * bootstrap refresh and the maintenance read, which means an endpoint the
 * harness left unmocked.
 */
export const test = base.extend<{ apiFallback: ApiFallback }>({
  apiFallback: [
    async ({ context }, use) => {
      const answered: string[] = []
      const escaped: string[] = []
      /** Each page's main-frame navigation in flight: its request, from the request to its commit, failure or end. The old document is outside the service worker, and a 401 would sign it out and redirect over the navigation, so the calls of a navigating page are aborted. */
      const navigating = new Map<Page, Request>()
      /** Calls aborted while another page, not navigating, could have made them. The routed requests are the service worker's pass-throughs, which carry no frame, so the caller cannot be told; such a call is an unmocked endpoint swallowed, and teardown fails on it. */
      const swallowed: string[] = []
      /** Tracks `page`'s main-frame navigations in `navigating`. */
      const watch = (page: Page) => {
        page.on('request', (request) => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            navigating.set(page, request)
          }
        })
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) navigating.delete(page)
        })
        /** Ends `page`'s tracked navigation when its own request fails or finishes without a commit. */
        const end = (request: Request) => {
          if (navigating.get(page) === request) navigating.delete(page)
        }
        page.on('requestfailed', end)
        page.on('requestfinished', end)
      }
      context.pages().forEach(watch)
      context.on('page', watch)
      await context.route(isApi, async (route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        const call = `${request.method()} ${pathname}`
        if (navigating.size > 0) {
          const others = context.pages().filter((page) => !navigating.has(page))
          if (others.some((page) => page.url() !== 'about:blank')) swallowed.push(call)
          await route.abort('aborted')
          return
        }
        answered.push(call)
        if (call === MAINTENANCE_STATUS) {
          await route.fulfill({
            status: 200,
            headers: { [FALLBACK_HEADER]: '1', 'Maintenance-Mode': 'off' },
            json: MAINTENANCE_OFF,
          })
          return
        }
        if (call === PASSKEY_CONFIG) {
          await route.fulfill({
            status: 200,
            headers: { [FALLBACK_HEADER]: '1' },
            json: PASSKEYS_OFF,
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

      await use({ answered, swallowed })

      expect(
        swallowed,
        'calls aborted during a navigation that another open page could have made'
      ).toEqual([])
      expect(escaped, '/api responses that came from the dev server proxy').toEqual([])
      expect(
        answered.filter(
          (call) =>
            call !== BOOTSTRAP_REFRESH && call !== MAINTENANCE_STATUS && call !== PASSKEY_CONFIG
        ),
        'endpoints nothing mocked, answered by the fallback'
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
