import { expect, test } from '@playwright/test'
import { settle } from '../timing'
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
  // The document title the real browser sets once the bundle has run and the
  // route's head() has applied, not merely the <title> index.html ships.
  await expect(page).toHaveTitle('Sign in · React Boilerplate')
})

test(
  'the served app never blanks #root or shows a second spinner while the root beforeLoad is slow',
  { tag: '@no-api' },
  async ({ page }) => {
    // No backend needed: this is intercepted in the browser before it ever
    // reaches nginx. It holds well past defaultPendingMs (300) so a boot
    // sequence that renders before the load resolves has time to blank
    // #root and show the router's own pending screen before this settles.
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await settle(600, 'injected latency: hold the root beforeLoad past defaultPendingMs (300)')
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Unauthorized', statusCode: 401 }),
      })
    })

    // Installed at document-create time, before any of the page's own
    // scripts run — before `document.documentElement` even exists, which is
    // why this observes `document` itself (always a valid Node) rather than
    // waiting on an element that isn't there yet. `#root` is looked up fresh
    // in each callback, so the empty check only starts meaning anything once
    // it exists. Keys `__sawRoutePending` on `aria-label`, not `role`,
    // because the splash itself carries `role="status"` too. `__mutations`
    // counts every callback invocation, so a browser where the observer never
    // ran at all — and so never had a chance to flip either flag — fails
    // loudly instead of passing on two flags that both stayed false by
    // default.
    await page.addInitScript(() => {
      const win = window as unknown as {
        __rootWasEmpty: boolean
        __sawRoutePending: boolean
        __mutations: number
      }
      win.__rootWasEmpty = false
      win.__sawRoutePending = false
      win.__mutations = 0

      const isRoutePending = (node: Node) =>
        node instanceof HTMLElement &&
        (node.matches('[role="status"][aria-label="Loading"]') ||
          node.querySelector('[role="status"][aria-label="Loading"]') !== null)

      const observer = new MutationObserver((mutations) => {
        win.__mutations += 1
        const root = document.getElementById('root')
        if (root && root.childElementCount === 0) win.__rootWasEmpty = true
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (isRoutePending(node)) win.__sawRoutePending = true
          })
        }
      })
      observer.observe(document, { childList: true, subtree: true })
    })

    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()

    const flags = await page.evaluate(() => {
      const win = window as unknown as {
        __rootWasEmpty: boolean
        __sawRoutePending: boolean
        __mutations: number
      }
      return {
        rootWasEmpty: win.__rootWasEmpty,
        sawRoutePending: win.__sawRoutePending,
        mutations: win.__mutations,
      }
    })
    expect(flags.mutations).toBeGreaterThan(0)
    expect(flags.rootWasEmpty).toBe(false)
    expect(flags.sawRoutePending).toBe(false)
  }
)
