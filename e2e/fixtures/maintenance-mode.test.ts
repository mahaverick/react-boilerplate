import type { BrowserContext } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'

/**
 * Maintenance mode through the harness, in a real browser. The harness leaves
 * the status read unmocked, so these tests answer it, and the write they
 * refuse, with `context.route`, which Playwright consults before the hermetic
 * fallback. Each answer carries `FALLBACK_HEADER` and the `Maintenance-Mode`
 * header express sets on every response. Express's own side, the gate and the
 * mode switch, needs the live stack.
 */

const SINCE = '2026-10-06T10:42:00.000Z'
const MESSAGE = 'Upgrading the database. Back by 11:00.'

type Mode = 'off' | 'read_only' | 'full'

const HARNESS_ACME = '/e2e/harness/?path=/tenants/acme'

/**
 * The dev server transforms a lazily loaded route's modules on first request,
 * which has taken past 5s under load (the contrast suite measured past 7s);
 * each test's first page assertion waits this long, below the 30s test timeout.
 */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/** Answers the status endpoint with whatever `state.mode` is when each request lands. */
async function routeStatus(context: BrowserContext, state: { mode: Mode; reads: number }) {
  await context.route('**/api/v1/status/maintenance', async (route) => {
    state.reads += 1
    const { mode } = state
    await route.fulfill({
      status: 200,
      headers: { [FALLBACK_HEADER]: '1', 'Maintenance-Mode': mode },
      json: {
        success: true,
        message: 'Maintenance status retrieved.',
        statusCode: 200,
        data:
          mode === 'off'
            ? { mode, message: null, since: null }
            : { mode, message: MESSAGE, since: SINCE },
      },
    })
  })
}

test('full: the maintenance screen replaces the app, and the app returns to the same page when it ends', async ({
  page,
  context,
}) => {
  const status: { mode: Mode; reads: number } = { mode: 'off', reads: 0 }
  await routeStatus(context, status)
  // The poll is 30 s plus up to 10 s of jitter; the test moves the page's clock instead of waiting.
  await page.clock.install()
  // A first visit with maintenance off, so the page's route chunks are already in the browser when it ends.
  await page.goto(HARNESS_ACME)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })

  // A fresh harness load, not a reload: the harness has replaced its URL with the app's.
  status.mode = 'full'
  await page.goto(HARNESS_ACME)
  await expect(page.getByRole('heading', { name: 'We’ll be back soon' })).toBeVisible()
  await expect(page.getByText(MESSAGE)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

  status.mode = 'off'
  const readsBefore = status.reads
  await page.clock.runFor(40_000)
  await expect.poll(() => status.reads).toBeGreaterThan(readsBefore)

  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'We’ll be back soon' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/tenants\/acme(\?|$)/)
})

test('read_only: a refused save toasts, the banner appears from that response, and the form keeps its input', async ({
  page,
  context,
}) => {
  const status: { mode: Mode; reads: number } = { mode: 'off', reads: 0 }
  await routeStatus(context, status)
  await context.route('**/api/v1/profile', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    status.mode = 'read_only'
    await route.fulfill({
      status: 503,
      headers: { [FALLBACK_HEADER]: '1', 'Maintenance-Mode': 'read_only', 'Retry-After': '30' },
      json: {
        success: false,
        message: MESSAGE,
        statusCode: 503,
        code: 'READ_ONLY_MODE',
        mode: 'read_only',
        since: SINCE,
        requestId: 'e2e',
      },
    })
  })
  await page.goto('/e2e/harness/?path=/profile')

  const firstName = page.getByLabel('First name')
  await expect(firstName).toHaveValue('A', { timeout: COLD_TRANSFORM_BUDGET_MS })
  await expect(page.getByRole('region', { name: 'Maintenance' })).toHaveCount(0)
  await firstName.fill('Ada')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByText('Changes are paused during maintenance.')).toBeVisible()
  const banner = page.getByRole('region', { name: 'Maintenance' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(MESSAGE)
  await expect(firstName).toHaveValue('Ada')

  await banner.getByRole('button', { name: 'Hide details' }).click()
  await expect(banner.getByText(MESSAGE)).toBeHidden()
  await expect(banner).toContainText('changes are paused')
})
