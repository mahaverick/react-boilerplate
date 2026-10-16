/**
 * @file The list checks jsdom cannot make, because it has no layout: each list
 * stacks as cards on a phone without scrolling the page sideways, and a sort
 * writes the URL and marks the header. They run against the MSW harness in
 * `e2e/harness/`, so they need no backend.
 */
import { expect, test } from '../hermetic'

/** A cold Vite transform of a route chunk; the contrast suite allows the same. */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/** The lists, each by its harness path and the name its table or card list carries. */
const LISTS = [
  { path: '/tenants', name: 'Tenants' },
  { path: '/settings/workspace/acme/members', name: 'Members' },
  { path: '/settings/workspace/acme/activity', name: 'Activity' },
  { path: '/notifications', name: 'Notifications' },
] as const

test.describe('lists at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const list of LISTS) {
    test(`${list.name} stacks as cards with no sideways scroll`, async ({ page }) => {
      await page.goto(`/e2e/harness/?path=${list.path}`)
      await expect(page.getByRole('list', { name: list.name })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })
      await expect(page.getByRole('table')).toHaveCount(0)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow).toBe(0)
    })
  }
})

test('sorting the members list writes ?sort= and marks the header', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/settings/workspace/acme/members')
  const table = page.getByRole('table', { name: 'Members' })
  await expect(table).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await table.getByRole('button', { name: 'Email' }).click()
  await expect(table.getByRole('columnheader', { name: 'Email' })).toHaveAttribute(
    'aria-sort',
    'ascending'
  )
  await expect(page).toHaveURL(/sort=email/)
})
