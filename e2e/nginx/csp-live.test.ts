import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  createTenant,
  createVerifiedUser,
  freshEmail,
  freshSlug,
  logIn,
} from '../live/helpers'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  watchCspViolations,
} from './csp'

/**
 * The enforced policy over the parts of the app that need a live API: the
 * signed-in shell with its notification stream open, and a tenant page.
 * Needs the container and express on :4040; `pnpm test:e2e:nginx` runs it.
 */

test.skip(process.env.E2E_LIVE !== '1', 'needs a live API — set E2E_LIVE=1 (pnpm test:e2e:nginx)')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
  await requireServedApp()
})

test('the signed-in app, its live stream and a tenant page run with no violation', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const email = freshEmail()
  await createVerifiedUser(email)
  const slug = freshSlug()
  const name = `E2E ${slug}`
  await createTenant(await apiLogin(email), { name, slug })

  const violations = await watchCspViolations(page)
  const stream = page.waitForResponse(
    (response) => response.url().includes('/notifications/stream') && response.status() === 200,
    { timeout: 30_000 }
  )
  await logIn(page, email)
  await stream

  const tenant = await page.goto(`/tenants/${slug}`)
  expect(tenant?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await flushCspReports(page)
  expect(violations).toEqual([])
})
