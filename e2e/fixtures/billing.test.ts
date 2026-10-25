/**
 * @file The billing flows in a real browser against the MSW harness:
 * `?billing=` picks the workspace's billing state, `?members=` the members
 * count, and `?razorpay=fake` installs a `window.Razorpay` that completes
 * every Checkout at once and records the options it was opened with. Dates in
 * the Paid states are fixed (`tests/fixtures/billing.ts`), so each line is
 * checked word for word.
 */
import type { Page } from '@playwright/test'
import { runAxe } from '../helpers/axe'
import { expect, test } from '../hermetic'

/** The harness URL for `path`, with `query` (`&key=value…`) after it. */
function harness(path: string, query = ''): string {
  return `/e2e/harness/?path=${encodeURIComponent(path)}${query}`
}

const BILLING = '/settings/workspace/acme/billing'

/** The options the fake Checkout was opened with, oldest first, without its callbacks. */
async function checkoutsOpened(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () =>
      (window as unknown as { razorpayFakeOpened?: Record<string, unknown>[] })
        .razorpayFakeOpened ?? []
  )
}

/** The Plan card's state line. */
function stateLine(page: Page) {
  return page.locator('[data-slot="billing-state"]')
}

test('a full Free workspace warns on the members page, and the owner’s Upgrade opens Billing', async ({
  page,
}) => {
  await page.goto(harness('/settings/workspace/acme/members', '&billing=free&members=3'))
  const note = page.getByText("You've used 3 of 3 members on Free. Upgrade to add more.")
  await expect(note).toBeVisible()

  await page.getByRole('link', { name: 'Upgrade', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/workspace\/acme\/billing(\?|$)/)
  await expect(stateLine(page)).toHaveText('Free')
  await expect(page.getByRole('button', { name: 'Upgrade to Paid' })).toBeVisible()
})

test('a workspace over the Free limit says how many to remove', async ({ page }) => {
  await page.goto(harness('/settings/workspace/acme/members', '&billing=free_over'))
  await expect(
    page.getByText('5 of 3 members on Free. Upgrade to add more, or remove 2.')
  ).toBeVisible()
})

test('an editor asks the owners to upgrade from Billing', async ({ page }) => {
  await page.goto(harness(BILLING, '&state=editor&billing=free'))
  await expect(page.getByText('Only owners can change billing.')).toBeVisible()
  await page.getByRole('button', { name: 'Request upgrade' }).click()
  await expect(
    page.getByText('Request sent. Owners will see it in their notifications.')
  ).toBeVisible()
  await expect(page.getByText('Requested', { exact: true })).toBeVisible()
})

test('the harness refuses an upgrade request body express would refuse', async ({ page }) => {
  await page.goto(harness(BILLING, '&state=editor&billing=free'))
  await expect(page.getByRole('button', { name: 'Request upgrade' })).toBeVisible()
  const statuses = await page.evaluate(async () => {
    const bodies = [
      {},
      { surface: 'nowhere' },
      { surface: 'limit', key: 'seats' },
      { surface: 'limit', key: 'members', note: 'extra' },
      { surface: 'limit', key: 'members' },
      { surface: 'billing_page' },
    ]
    const answers = []
    for (const body of bodies) {
      const response = await fetch('/api/v1/tenants/acme/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      answers.push(response.status)
    }
    return answers
  })
  expect(statuses).toEqual([400, 400, 400, 400, 201, 201])
})

test('an owner on Free upgrades through Checkout and reads the new state line', async ({
  page,
}) => {
  await page.goto(harness(BILLING, '&billing=free&razorpay=fake'))
  await expect(stateLine(page)).toHaveText('Free')
  await page.getByRole('button', { name: 'Upgrade to Paid' }).click()

  await expect(page.getByText('You’re on Paid.', { exact: true })).toBeVisible()
  await expect(stateLine(page)).toHaveText('Paid · ₹999 per month · Renews 25 November 2026')
  const [opened, ...more] = await checkoutsOpened(page)
  expect(more).toEqual([])
  expect(opened).toMatchObject({ key: 'rzp_test_harness', subscription_id: 'sub_harness_upgrade' })
  expect(opened).not.toHaveProperty('subscription_card_change')
})

test('an owner cancels Paid and keeps it to the period’s end', async ({ page }) => {
  await page.goto(harness(BILLING, '&billing=active'))
  await expect(stateLine(page)).toHaveText('Paid · ₹999 per month · Renews 2 November 2026')

  await page.getByRole('button', { name: 'Cancel Paid' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Cancel Paid?' })
  await expect(dialog).toContainText(
    'You keep Paid until 2 November 2026. Then the workspace moves to Free. Nothing is deleted.'
  )
  await dialog.getByRole('button', { name: 'Cancel Paid' }).click()

  await expect(page.getByText('Paid ends on 2 November 2026.', { exact: true })).toBeVisible()
  await expect(stateLine(page)).toHaveText(
    'Paid · Ends 2 November 2026. You won’t be charged again.'
  )
  await expect(page.getByRole('button', { name: 'Keep Paid after 2 November 2026' })).toBeVisible()
})

test('cancelling before the first charge goes back to the trial with no period end', async ({
  page,
}) => {
  await page.goto(harness(BILLING, '&razorpay=fake'))
  await expect(stateLine(page)).toContainText('Paid trial · Ends')
  await page.getByRole('button', { name: 'Upgrade to Paid' }).click()
  await expect(stateLine(page)).toContainText('Paid · First charge of ₹999 on')

  await page.getByRole('button', { name: 'Cancel Paid' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Cancel Paid?' })
  await dialog.getByRole('button', { name: 'Cancel Paid' }).click()
  await expect(stateLine(page)).toContainText('Paid trial · Ends')

  const views = await page.evaluate(async () => {
    /** The `data` of a GET the harness answers. */
    const read = async (path: string) =>
      ((await (await fetch(path)).json()) as { data: Record<string, unknown> }).data
    return {
      billing: await read('/api/v1/tenants/acme/billing'),
      entitlements: await read('/api/v1/tenants/acme/entitlements'),
    }
  })
  expect(views.billing).toMatchObject({
    state: 'trialing',
    price: null,
    currentPeriodEnd: null,
    nextSwitch: null,
  })
  expect(views.entitlements).toMatchObject({ state: 'trialing', currentPeriodEnd: null })
})

test('past due, Billing’s one Update card opens Checkout as a card change', async ({ page }) => {
  await page.goto(harness(BILLING, '&billing=past_due&razorpay=fake'))
  await expect(stateLine(page)).toHaveText('Paid · Payment failed on 20 October 2026')
  // Billing shows no billing banner, so its card button is the only one.
  await expect(page.getByText(/Update your card by 27 October 2026/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update card' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Update card' }).click()

  await expect(
    page.getByText('Card updated. Razorpay restarts your subscription with it.', {
      exact: true,
    })
  ).toBeVisible()
  const opened = await checkoutsOpened(page)
  expect(opened).toHaveLength(1)
  expect(opened[0]).toMatchObject({
    subscription_id: 'sub_harness_card_change',
    subscription_card_change: 1,
  })
})

test('the past-due banner’s Update card opens Checkout as a card change', async ({ page }) => {
  await page.goto(harness('/tenants/acme', '&billing=past_due&razorpay=fake'))
  await expect(
    page.getByText(
      'Your card payment of ₹999 failed on 20 October 2026. Update your card by 27 October 2026 to keep Paid.'
    )
  ).toBeVisible()
  await page.getByRole('button', { name: 'Update card' }).click()

  await expect(
    page.getByText('Card updated. Razorpay restarts your subscription with it.', {
      exact: true,
    })
  ).toBeVisible()
  const opened = await checkoutsOpened(page)
  expect(opened).toHaveLength(1)
  expect(opened[0]).toMatchObject({
    subscription_id: 'sub_harness_card_change',
    subscription_card_change: 1,
  })
})

test('with payments off, Billing and Pricing say so instead of offering to pay', async ({
  page,
}) => {
  await page.goto(harness(BILLING, '&billing=payments_off'))
  await expect(stateLine(page)).toContainText('Paid trial · Ends')
  await expect(page.getByText('Payments aren’t set up yet.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upgrade to Paid' })).toHaveCount(0)

  await page.goto(harness('/pricing?tenant=acme', '&billing=payments_off'))
  await expect(page.getByRole('heading', { level: 1, name: 'Plans' })).toBeVisible()
  await expect(page.getByText('Payments aren’t set up yet.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Upgrade', exact: true })).toHaveCount(0)
})

test.describe('accessibility', () => {
  for (const state of ['trialing', 'free', 'active', 'past_due'] as const) {
    test(`Billing in the ${state} state is axe-clean`, async ({ page }) => {
      await page.goto(harness(BILLING, `&billing=${state}`))
      await expect(stateLine(page)).toBeVisible()
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
      const results = await runAxe(page)
      expect(results.violations).toEqual([])
      // Not vacuous: axe evaluated the page's landmarks and headings.
      expect(results.passes).toEqual(
        expect.arrayContaining(['landmark-one-main', 'page-has-heading-one'])
      )
    })
  }

  test('the cancel dialog is axe-clean', async ({ page }) => {
    await page.goto(harness(BILLING, '&billing=active'))
    await page.getByRole('button', { name: 'Cancel Paid' }).click()
    await expect(page.getByRole('alertdialog', { name: 'Cancel Paid?' })).toBeVisible()
    const results = await runAxe(page, '[role="alertdialog"]')
    expect(results.violations).toEqual([])
  })

  test('Billing fits 390px wide with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(harness(BILLING, '&billing=active'))
    await expect(page.getByRole('button', { name: 'Cancel Paid' })).toBeVisible()
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
  })
})
