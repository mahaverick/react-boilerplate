import { expect, test } from '@playwright/test'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  watchCspViolations,
} from './csp'

/**
 * The enforced Content-Security-Policy against the real bundle. Tagged
 * `@no-api`: CI runs these against the container with nothing behind `/api`,
 * so the session bootstrap's refresh answers 502 and the page still has to
 * render. Each test asserts the policy header too, or "no violation" would
 * pass on an image that sends no policy at all.
 */

test.beforeAll(requireServedApp)

test(
  'the sign-in page renders under the policy with no violation',
  { tag: '@no-api' },
  async ({ page }) => {
    const violations = await watchCspViolations(page)
    const response = await page.goto('/login')
    expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
    // sonner injects a <style> element: the page really exercised style-src.
    await expect(page.locator('head style')).not.toHaveCount(0)
    await page.waitForLoadState('networkidle')
    await flushCspReports(page)
    expect(violations).toEqual([])
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
