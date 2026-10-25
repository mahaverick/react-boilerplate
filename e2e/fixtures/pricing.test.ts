/**
 * @file The public pricing page in a real browser against the MSW harness:
 * both plans' prices and the trial line signed out, the owner's Upgrade
 * signed in, and axe over the whole page.
 */
import { runAxe } from '../helpers/axe'
import { expect, test } from '../hermetic'

/** The harness URL for `path`, with `query` (`&key=value…`) after it. */
function harness(path: string, query = ''): string {
  return `/e2e/harness/?path=${encodeURIComponent(path)}${query}`
}

test('signed out, it shows both plans’ prices, the trial line and Start free', async ({ page }) => {
  await page.goto(harness('/pricing', '&session=none'))
  const free = page.getByRole('region', { name: 'Free' })
  const paid = page.getByRole('region', { name: 'Paid' })
  await expect(free.getByText('₹0', { exact: true })).toBeVisible()
  await expect(paid.getByText('₹999 per month', { exact: true })).toBeVisible()
  await expect(paid.getByText('or ₹9,990 per year (2 months free)', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Try Paid free for 14 days. No card needed.', { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start free' })).toBeVisible()
})

test('signed in as the owner of ?tenant, Upgrade opens that workspace’s Billing', async ({
  page,
}) => {
  await page.goto(harness('/pricing?tenant=acme'))
  await page.getByRole('link', { name: 'Upgrade', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/workspace\/acme\/billing(\?|$)/)
  await expect(page.locator('[data-slot="billing-state"]')).toContainText('Paid trial · Ends')
})

for (const session of ['signed out', 'signed in'] as const) {
  test(`is axe-clean ${session}`, async ({ page }) => {
    await page.goto(harness('/pricing', session === 'signed out' ? '&session=none' : ''))
    await expect(page.getByRole('region', { name: 'Paid' })).toBeVisible()
    await expect(
      page.getByRole('link', {
        name: session === 'signed out' ? 'Start free' : 'Go to your workspaces',
      })
    ).toBeVisible()
    const results = await runAxe(page)
    expect(results.violations).toEqual([])
    expect(results.passes).toEqual(
      expect.arrayContaining(['landmark-one-main', 'page-has-heading-one'])
    )
  })
}
