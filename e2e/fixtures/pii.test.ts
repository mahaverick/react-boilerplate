/**
 * @file The DOM half of the analytics PII guard. With `?pii=probe` the harness
 * gives every person the probe's name and an address starting `pii-probe`, and
 * on each page, with each name-bearing popup open, every text node containing a
 * probe must sit inside an element carrying both `ph-sensitive` and `ph-mask`
 * (what `<Pii>` renders). The network half, which reads what leaves the browser,
 * is `e2e/nginx/analytics.test.ts`.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'

/** Each name part alone (the dashboard greets by first name) and the address prefix. */
const PROBES = ['Pii', 'Probe', 'pii-probe']

/** A token the accept page's schema takes, so it renders the preview. */
const TOKEN = 'pii-probe-token-'.padEnd(43, 'x')

/** What a page scan found: how many probe text nodes are masked, and a description of each unmasked one. */
interface ProbeScan {
  masked: number
  unmasked: string[]
}

/** Sorts the page's text nodes that contain a probe into masked (inside `.ph-sensitive.ph-mask`) and unmasked. */
async function scanProbes(page: Page): Promise<ProbeScan> {
  return page.evaluate((probes) => {
    const scan: ProbeScan = { masked: 0, unmasked: [] }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      if (!probes.some((probe) => text.includes(probe))) continue
      const element = node.parentElement
      if (element?.closest('.ph-sensitive.ph-mask')) scan.masked += 1
      else scan.unmasked.push(`<${element?.tagName.toLowerCase() ?? '?'}> ${text.trim()}`)
    }
    return scan
  }, PROBES)
}

/** Every probe on the page is masked, and at least `atLeast` are there to check. */
async function expectAllMasked(page: Page, atLeast: number): Promise<void> {
  const scan = await scanProbes(page)
  expect(scan.unmasked, 'probe text outside .ph-sensitive.ph-mask').toEqual([])
  expect(scan.masked).toBeGreaterThanOrEqual(atLeast)
}

/** The harness URL for `path` in `?pii=probe` mode, with `extra` appended to the query. */
function harness(path: string, extra = ''): string {
  return `/e2e/harness/?pii=probe&path=${path}${extra}`
}

test('the dashboard and the account menu mask the user', async ({ page }) => {
  await page.goto(harness('/dashboard'))
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  await expectAllMasked(page, 2)
  // Initials carry no probe string, so the avatar is checked by its own text.
  await expect(page.getByText('PP', { exact: true })).toHaveClass(/\bph-sensitive\b.*\bph-mask\b/)

  await page.getByRole('button', { name: /Account menu for/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible()
  await expectAllMasked(page, 2)
})

test('the profile masks the address', async ({ page }) => {
  await page.goto(harness('/settings/account/profile'))
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  // Scoped to the page: the sidebar's account menu shows the address too, and the scan below covers both.
  await expect(page.getByRole('main').getByText('pii-probe@example.test')).toBeVisible()
  await expectAllMasked(page, 2)
})

test('the notifications mask a body that names someone', async ({ page }) => {
  await page.goto(harness('/notifications'))
  await expect(page.getByText('Pii Probe sent you a link.')).toBeVisible()
  await expectAllMasked(page, 1)
})

test('the members page masks members, invitees, inviters, the remove dialog and toasts', async ({
  page,
}) => {
  await page.goto(harness('/settings/workspace/acme/members'))
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible()
  await expect(page.getByText('pii-probe+invitee@example.test')).toBeVisible()
  await expectAllMasked(page, 5)

  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expectAllMasked(page, 7)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: /^Resend invitation to/ }).click()
  await expect(page.getByText(/^Invitation resent to/)).toBeVisible()
  await expectAllMasked(page, 6)
})

test('the activity log masks actors, and so does its actor filter', async ({ page }) => {
  await page.goto(harness('/settings/workspace/acme/activity'))
  await expect(page.getByRole('list', { name: 'Activity' })).toBeVisible()
  await expectAllMasked(page, 2)

  await page.getByRole('combobox', { name: 'Filter by who acted' }).click()
  await expect(page.getByRole('option', { name: 'Anyone' })).toBeVisible()
  await expectAllMasked(page, 4)
})

test('the invitation page masks the inviter and both addresses', async ({ page }) => {
  await page.goto(harness('/invitations/accept', `&token=${TOKEN}`))
  await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Corp' })).toBeVisible()
  await expectAllMasked(page, 3)
})
