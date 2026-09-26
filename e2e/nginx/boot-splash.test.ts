import { expect, test } from '@playwright/test'
import { flushCspReports, requireServedApp, watchCspViolations } from './csp'

/**
 * The static splash in index.html's #root, against the production image. It
 * is styled by the stylesheet linked in <head>, so it must paint with the
 * bundle blocked, and React must replace it once the bundle runs.
 */

test.beforeAll(requireServedApp)

test(
  'the served index.html carries the splash inside #root',
  { tag: '@no-api' },
  async ({ request }) => {
    const html = await (await request.get('/')).text()
    expect(html).toMatch(/<div id="root">\s*<div class="boot-splash" role="status">/)
    expect(html).toContain('Loading…')
  }
)

test.describe('with the bundle blocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/assets/*.js', (route) => route.abort())
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in a ${colorScheme} colour scheme`, () => {
      test.use({ colorScheme })

      test('paints the styled splash with no violation', { tag: '@no-api' }, async ({ page }) => {
        const violations = await watchCspViolations(page)
        await page.goto('/login')
        const splash = page.locator('.boot-splash')
        await expect(splash).toBeVisible()
        await expect(splash).toHaveAttribute('role', 'status')
        await expect(splash).toHaveText('Loading…')
        // `flex` comes from the stylesheet; unstyled, a div is `block`.
        await expect(splash).toHaveCSS('display', 'flex')
        await flushCspReports(page)
        expect(violations).toEqual([])
      })
    })
  }
})

test('the app replaces the splash once it renders', { tag: '@no-api' }, async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
  await expect(page.locator('.boot-splash')).toHaveCount(0)
})
