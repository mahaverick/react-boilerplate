/**
 * @file The static splash in index.html's #root, against the production image.
 * It is styled by the stylesheet linked in `<head>`, so it must paint with the
 * bundle blocked, and React must replace it once the bundle runs.
 */
import { expect, test } from '@playwright/test'
import { settle } from '../timing'
import { flushCspReports, requireServedApp, watchCspViolations } from './csp'

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
  // The title the router sets once the bundle has run, not the <title> index.html ships.
  await expect(page).toHaveTitle('Sign in · React Boilerplate')
})

// The refresh is held well past `defaultPendingMs` (300), so a boot that renders before the load resolves has time to blank #root and show the router's pending screen.
test(
  'the served app never blanks #root or shows a second spinner while the root beforeLoad is slow',
  { tag: '@no-api' },
  async ({ page }) => {
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await settle(600, 'injected latency: hold the root beforeLoad past defaultPendingMs (300)')
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Unauthorized', statusCode: 401 }),
      })
    })

    // Runs before any page script, before `document.documentElement` exists, so it observes `document` itself.
    await page.addInitScript(() => {
      const win = window as unknown as {
        __rootWasEmpty: boolean
        __sawRoutePending: boolean
        __mutations: number
      }
      win.__rootWasEmpty = false
      win.__sawRoutePending = false
      // Counts callbacks, so an observer that never ran fails loudly instead of passing on two flags that stayed false.
      win.__mutations = 0

      /** Whether `node` is, or contains, the router's pending screen; keyed on aria-label, not role, because the splash also carries role="status". */
      const isRoutePending = (node: Node) =>
        node instanceof HTMLElement &&
        (node.matches('[role="status"][aria-label="Loading"]') ||
          node.querySelector('[role="status"][aria-label="Loading"]') !== null)

      const observer = new MutationObserver((mutations) => {
        win.__mutations += 1
        // Emptiness is read live, once per callback: React's first commit clears #root and inserts the app in the same task, so a per-record check would flag every correct boot.
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
