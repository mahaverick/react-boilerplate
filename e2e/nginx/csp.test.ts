/**
 * @file The enforced Content-Security-Policy against the real bundle. Tagged
 * `@no-api`: CI runs these against the container with nothing behind `/api`, so
 * the session bootstrap's refresh answers 502 and the page still has to render.
 * The sign-in test and the dark-scheme theme-script test also assert the policy
 * header, or "no violation" would pass on an image that sends no policy at all.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { afterFontsAndFrames } from '../timing'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  routeSignInLinkChunk,
  watchCspViolations,
} from './csp'

test.beforeEach(requireServedApp)

/**
 * Records every script chunk `page` fetches after this call that index.html
 * does not name: the chunks the router loads on demand. The returned list keeps
 * filling.
 */
async function recordOnDemandChunks(page: Page, request: APIRequestContext): Promise<string[]> {
  const html = await (await request.get('/')).text()
  const upFront = new Set(html.match(/\/assets\/[\w.-]+\.js/g) ?? [])
  const onDemand: string[] = []
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (/^\/assets\/[\w.-]+\.js$/.test(pathname) && !upFront.has(pathname)) {
      onDemand.push(pathname)
    }
  })
  return onDemand
}

test(
  'the sign-in page renders under the policy with no violation',
  { tag: '@no-api' },
  async ({ page, request }) => {
    const onDemand = await recordOnDemandChunks(page, request)
    const violations = await watchCspViolations(page)
    // An OAuth `?error=` raises a toast, so the lazy toast chunk loads and renders under the policy too. Nothing here injects a <style> any more: Base UI's Select does, behind sign-in, out of reach `@no-api`.
    const response = await page.goto('/login?error=google_auth_failed')
    expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
    await expect(
      page.getByText('Google sign-in failed. Try again, or sign in with an email link.')
    ).toBeVisible()
    // The heading means the refresh has settled and the route's lazy chunk has run; a late violation can still come from the webfont or a lazy chunk, so wait for the fonts and one page task.
    await expect.poll(() => onDemand.length).toBeGreaterThan(0)
    await afterFontsAndFrames(page)
    await flushCspReports(page)
    expect(violations).toEqual([])
  }
)

test(
  'a lazily loaded route loads under the policy with no violation',
  { tag: '@no-api' },
  async ({ page, request }) => {
    const onDemand = await recordOnDemandChunks(page, request)
    const violations = await watchCspViolations(page)

    // With nothing behind /api the request is answered here, so "Check your inbox" renders as it would after a real send.
    await page.route('**/api/v1/auth/link/request', (route) =>
      route.fulfill({
        status: 202,
        json: {
          success: true,
          message: 'Check your inbox for a sign-in link.',
          statusCode: 202,
          data: null,
        },
      })
    )
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('csp@example.test')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your inbox', level: 1 })).toBeVisible()

    // A route whose chunk loads on demand: a link with no token is the dead-link page, whatever the API.
    await page.goto('/auth/link')
    await expect(
      page.getByRole('heading', { name: 'This link expired or was already used', level: 1 })
    ).toBeVisible()

    expect(onDemand.some((chunk) => chunk.startsWith('/assets/link-'))).toBe(true)
    await flushCspReports(page)
    expect(violations).toEqual([])
  }
)

test(
  'a missing route chunk after a deploy offers a reload',
  { tag: '@no-api' },
  async ({ page }) => {
    let chunk404s = 0
    await routeSignInLinkChunk(page, (route) => {
      chunk404s += 1
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('/auth/link')
    await expect(page.getByText('A new version is available')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    // The reload screen came from the 404 this route served, not from some other failure.
    expect(chunk404s).toBeGreaterThan(0)
  }
)

test.describe('the pre-paint theme script', () => {
  // With the bundle blocked, nothing but /theme-init.js can set the class.
  test.beforeEach(async ({ page }) => {
    await page.route('**/assets/*.js', (route) => route.abort())
  })

  test.describe('in a dark colour scheme, with no stored theme', () => {
    test.use({ colorScheme: 'dark' })

    test('marks the document dark before the bundle runs', { tag: '@no-api' }, async ({ page }) => {
      const violations = await watchCspViolations(page)
      const script = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/theme-init.js'
      )
      const response = await page.goto('/login', { waitUntil: 'domcontentloaded' })
      expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
      expect((await script).headers()['content-type']).toBe('application/javascript')
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
        true
      )
      await flushCspReports(page)
      expect(violations).toEqual([])
    })
  })

  test.describe('in a light colour scheme, with no stored theme', () => {
    test.use({ colorScheme: 'light' })

    test('leaves the document light', { tag: '@no-api' }, async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded' })
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
        false
      )
    })
  })
})
