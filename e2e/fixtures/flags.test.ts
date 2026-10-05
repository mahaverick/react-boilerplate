import type { BrowserContext } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'
import { settle } from '../timing'

/**
 * The reference flags through the harness, in a real browser. `?flags=network`
 * leaves the flag routes to these tests, which answer them with
 * `context.route`: the MSW worker's pass-throughs are fetched by the service
 * worker, which only a context route sees. Each answer carries
 * `FALLBACK_HEADER`, or the hermetic teardown reports it as an escape.
 * Express's own side, the 404 a closed gated route answers, is not exercised
 * here: that needs the live stack.
 */

interface FlagRoutes {
  /** `GET /tenants/acme/beta` calls. */
  betaReads: number
  /** The `keys` of each exposure POST, in arrival order. */
  exposures: string[][]
}

/** An express success envelope, stamped as a test-fulfilled `/api` answer. */
function envelope(data: unknown, message: string) {
  return {
    status: 200,
    headers: { [FALLBACK_HEADER]: '1' },
    json: { success: true, message, statusCode: 200, data },
  }
}

/** Serves the flag reads with these values, the beta route while it is on, and records exposures. */
async function routeFlags(
  context: BrowserContext,
  flags: { example_beta_page: boolean; example_cta_experiment: 'control' | 'bold' }
): Promise<FlagRoutes> {
  const routes: FlagRoutes = { betaReads: 0, exposures: [] }
  const answer = envelope({ flags, evaluatedAt: '2026-10-05T09:00:00.000Z' }, 'Flags retrieved.')
  await context.route('**/api/v1/flags', (route) => route.fulfill(answer))
  await context.route('**/api/v1/tenants/acme/flags', (route) => route.fulfill(answer))
  await context.route('**/api/v1/tenants/acme/flags/exposures', async (route) => {
    routes.exposures.push((route.request().postDataJSON() as { keys: string[] }).keys)
    await route.fulfill({ status: 204, headers: { [FALLBACK_HEADER]: '1' } })
  })
  await context.route('**/api/v1/tenants/acme/beta', async (route) => {
    routes.betaReads += 1
    await route.fulfill(
      flags.example_beta_page
        ? envelope({ slug: 'acme', enabledAt: '2026-10-05T09:00:00.000Z' }, 'Beta features are on.')
        : {
            status: 404,
            headers: { [FALLBACK_HEADER]: '1' },
            json: { success: false, message: 'Not found', statusCode: 404 },
          }
    )
  })
  return routes
}

test('example_beta_page on: the Beta tab opens the page, which reads the gated route', async ({
  page,
  context,
}) => {
  const routes = await routeFlags(context, {
    example_beta_page: true,
    example_cta_experiment: 'control',
  })
  await page.goto('/e2e/harness/?flags=network&path=/tenants/acme')
  const tabs = page.getByRole('navigation', { name: 'Tenant sections' })
  await tabs.getByRole('link', { name: 'Beta' }).click()
  await expect(page.getByText('Beta features are on for acme.')).toBeVisible()
  await expect(page).toHaveURL(/\/tenants\/acme\/beta/)
  expect(routes.betaReads).toBe(1)
})

test('example_beta_page off: no Beta tab, and its URL is not found without asking the API', async ({
  page,
  context,
}) => {
  const routes = await routeFlags(context, {
    example_beta_page: false,
    example_cta_experiment: 'control',
  })
  await page.goto('/e2e/harness/?flags=network&path=/tenants/acme')
  const tabs = page.getByRole('navigation', { name: 'Tenant sections' })
  await expect(tabs.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Beta' })).toHaveCount(0)

  await page.goto('/e2e/harness/?flags=network&path=/tenants/acme/beta')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  expect(routes.betaReads).toBe(0)
})

test('the CTA experiment renders its variant and reports one exposure per tab session', async ({
  page,
  context,
}) => {
  const routes = await routeFlags(context, {
    example_beta_page: false,
    example_cta_experiment: 'bold',
  })
  await page.goto('/e2e/harness/?flags=network&path=/tenants/acme')
  const cta = page.getByRole('link', { name: 'Open members' })
  await expect(cta).toHaveClass(/bg-primary/)
  await expect.poll(() => routes.exposures).toEqual([['example_cta_experiment']])

  // A new load in the same tab keeps its sessionStorage, so the same variant is not reported again.
  await page.goto('/e2e/harness/?flags=network&path=/tenants/acme')
  await expect(page.getByRole('link', { name: 'Open members' })).toHaveClass(/bg-primary/)
  await settle(500, 'absence has no event: a second exposure batch would have been sent by now')
  expect(routes.exposures).toHaveLength(1)
})
