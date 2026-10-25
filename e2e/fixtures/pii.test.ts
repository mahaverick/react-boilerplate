/**
 * @file The DOM half of the analytics PII guard. With `?pii=probe` the harness
 * gives every person the probe's name and an address starting `pii-probe`, and
 * on each page, with each name-bearing popup open, every text node containing a
 * probe must sit inside an element carrying both `ph-sensitive` and `ph-mask`
 * (what `<Pii>` renders). The network half, which reads what leaves the browser,
 * is `e2e/nginx/analytics.test.ts`.
 */
import type { Page } from '@playwright/test'
import { maskReplayAttribute } from '../../src/observability/telemetry/mask-attribute'
import { USER_ID_2 } from '../../tests/fixtures/ids'
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

  await page.getByRole('button', { name: /^Resend, invitation to/ }).click()
  await expect(page.getByText(/^Invitation resent to/)).toBeVisible()
  await expectAllMasked(page, 6)
})

test('the activity log masks actors, and so does its actor filter', async ({ page }) => {
  await page.goto(harness('/settings/workspace/acme/activity'))
  await expect(page.getByRole('table', { name: 'Activity' })).toBeVisible()
  await expectAllMasked(page, 2)

  await page.getByRole('button', { name: 'Filter by actor, Activity' }).click()
  await expect(page.getByRole('dialog', { name: 'Filter by actor, Activity' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Pii Probe/ }).first()).toBeVisible()
  await expectAllMasked(page, 4)

  // A chosen actor shows as a chip ("Actor: {name}") and as the remove button's label.
  await page.goto(harness('/settings/workspace/acme/activity', `&actor=${USER_ID_2}`))
  await expect(page.getByText('Actor: ')).toBeVisible()
  // The chip's name resolves from the member list, so wait for it before scanning.
  await expect(page.getByRole('button', { name: /^Remove filter: Actor: Pii Probe/ })).toBeVisible()
  await expectAllMasked(page, 3)
})

test('the invitation page, signed in as someone else, masks the inviter and both addresses', async ({
  page,
}) => {
  await page.goto(harness('/invitations/accept', `&token=${TOKEN}`))
  await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Corp' })).toBeVisible()
  await expectAllMasked(page, 3)
})

test('the sign-in page masks the address a link went to', async ({ page }) => {
  await page.goto(harness('/login', '&session=none'))
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('pii-probe+inbox@example.test')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
  await expectAllMasked(page, 1)
})

test('a sign-in link for another account masks both addresses', async ({ page }) => {
  const email = encodeURIComponent('pii-probe+link@example.test')
  await page.goto(harness('/auth/link', `&token=${TOKEN}&email=${email}`))
  await expect(page.getByRole('heading', { level: 1, name: 'Switch account?' })).toBeVisible()
  // The sentence names both, and each button names one.
  await expectAllMasked(page, 4)
})

test('the invitation’s Check your inbox masks the address it mailed', async ({ page }) => {
  await page.goto(harness('/invitations/accept', `&session=none&invite=inbox&token=${TOKEN}`))
  await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
  await expect(page.getByText('pii-probe+invitee@example.test')).toBeVisible()
  await expectAllMasked(page, 1)
})

test('a confirmation link for another account masks both addresses', async ({ page }) => {
  const email = encodeURIComponent('pii-probe+confirm@example.test')
  await page.goto(harness('/invitations/confirm', `&token=${TOKEN}&email=${email}`))
  await expect(page.getByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible()
  // The sentence names both, and Continue names the link's.
  await expectAllMasked(page, 3)
})

test('the passkeys list and both dialogs mask a passkey’s name and its button labels', async ({
  page,
}) => {
  await page.goto(harness('/settings/account/security'))
  const row = page.getByRole('listitem').filter({ hasText: 'Pii Probe’s phone' })
  await expect(row).toBeVisible()
  await expectAllMasked(page, 3)

  // The buttons' labels carry the name; replay masks the attribute.
  for (const action of ['Rename', 'Delete']) {
    const label = await row.getByRole('button', { name: action }).getAttribute('aria-label')
    expect(label).toBe(`${action} Pii Probe’s phone`)
    expect(maskReplayAttribute('aria-label', label!)).toBe('***')
  }

  await row.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('dialog', { name: 'Rename passkey' })).toBeVisible()
  await expectAllMasked(page, 3)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('alertdialog').getByText('Pii Probe’s phone')).toBeVisible()
  await expectAllMasked(page, 4)
})

test('the payer-left banner masks the payer who left', async ({ page }) => {
  await page.goto(harness('/tenants/acme', '&billing=payer_left'))
  await expect(page.getByText(/’s card, and they left the workspace\./)).toBeVisible()
  // The banner's payer, and the account menu's name and address.
  await expectAllMasked(page, 3)
})

test('Billing masks the payer, the receipts address and who asked to upgrade', async ({ page }) => {
  await page.goto(harness('/settings/workspace/acme/billing', '&billing=payer_left'))
  await expect(page.getByText(/^Receipts go to/)).toBeVisible()
  await expect(page.getByText(/asked to upgrade on/)).toHaveCount(2)
  // The Plan card's payer and address, two requesters, and the account menu's name and address; Billing has no billing banner.
  await expectAllMasked(page, 6)
})
