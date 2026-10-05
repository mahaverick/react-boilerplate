import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { settle } from '../timing'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  createTenant,
  createVerifiedUser,
  freshEmail,
  freshSlug,
  logIn,
} from './helpers'

/**
 * The reference flags against a real express with feature flags on and a fake
 * PostHog serving its definitions. Needs express 1.8.0 or later on :4040 with
 * `POSTHOG_FEATURE_FLAGS_KEY` set, and Mailpit for the account helpers, so it
 * is skipped unless `E2E_LIVE=1`. Run it with `pnpm test:e2e:live`.
 *
 * The live suite has no way to change the fake PostHog's flag definitions, so
 * this spec takes one from the environment. `E2E_FLAGS_SET_CMD` is an
 * executable that is run as `<cmd> <flag-key> <value>` and must leave the fake
 * serving that definition, then exit 0. The values are `on` or `off` for
 * `example_beta_page`, and `control` or `bold` for `example_cta_experiment`
 * (a multivariate flag the command keeps active at 100 % rollout). Express
 * reads definitions on a 30 s timer, so every assertion that follows a change
 * polls for up to 45 s. Without the variable the spec is skipped.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

const SET_CMD = process.env.E2E_FLAGS_SET_CMD
test.skip(!SET_CMD, 'E2E_FLAGS_SET_CMD is not set: nothing can change the fake PostHog definitions')

const execFile = promisify(execFileCallback)

/** Longest wait for express to pick up a changed definition: one 30 s fetch, plus margin. */
const DEFINITIONS_WAIT = 45_000

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start express 1.8.0+ first: cd ../express-boilerplate && pnpm dev`
    )
  }
})

async function setFlag(key: string, value: string): Promise<void> {
  await execFile(SET_CMD ?? '', [key, value], { timeout: 30_000 })
}

test('flag changes reach the tab, the page, the API and the exposure report', async ({ page }) => {
  test.setTimeout(240_000)

  await setFlag('example_beta_page', 'on')
  await setFlag('example_cta_experiment', 'bold')

  const owner = freshEmail()
  await createVerifiedUser(owner)
  const slug = freshSlug()
  const token = await apiLogin(owner)
  await createTenant(token, { name: `E2E ${slug}`, slug })

  const beta = () => apiRequest(token, 'GET', `/tenants/${slug}/beta`).then((r) => r.status)
  await expect
    .poll(beta, { message: 'the API never opened the beta route', timeout: DEFINITIONS_WAIT })
    .toBe(200)

  const exposures: { status: number }[] = []
  page.on('response', (response) => {
    const request = response.request()
    if (
      request.method() === 'POST' &&
      response.url().endsWith(`/tenants/${slug}/flags/exposures`)
    ) {
      exposures.push({ status: response.status() })
    }
  })
  const betaReads: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith(`/tenants/${slug}/beta`)) betaReads.push(response.status())
  })

  await logIn(page, owner)
  await page.goto(`/tenants/${slug}`)

  // The bold variant: a filled button, reported once for the tab session, across a reload.
  await expect(page.getByRole('link', { name: 'Open settings' })).toHaveClass(/bg-primary/)
  await expect.poll(() => exposures, { timeout: 15_000 }).toEqual([{ status: 204 }])
  await page.reload()
  await expect(page.getByRole('link', { name: 'Open settings' })).toHaveClass(/bg-primary/)
  await settle(3000, 'absence has no event: a second exposure batch would have been sent by now')
  expect(exposures).toHaveLength(1)

  // Beta on: the tab, the page, and the gated route's 200.
  const tabs = page.getByRole('navigation', { name: 'Tenant sections' })
  await tabs.getByRole('link', { name: 'Beta' }).click()
  await expect(page.getByText(`Beta features are on for ${slug}.`)).toBeVisible()
  expect(betaReads).toEqual([200])

  // Beta off: the API refuses once express has fetched the new definitions.
  await setFlag('example_beta_page', 'off')
  await expect
    .poll(beta, { message: 'the API kept answering the beta route', timeout: DEFINITIONS_WAIT })
    .toBe(404)

  // The tab list follows cached flags until they refetch, so reload before asserting it is gone.
  await page.goto(`/tenants/${slug}`)
  await expect(page.getByRole('navigation', { name: 'Tenant sections' })).toContainText('Settings')
  await expect(
    page.getByRole('navigation', { name: 'Tenant sections' }).getByRole('link', { name: 'Beta' })
  ).toHaveCount(0)
  await page.goto(`/tenants/${slug}/beta`)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
