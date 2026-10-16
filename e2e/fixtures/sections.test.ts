import { expect, test } from '../hermetic'

/**
 * One section's slow or failing request changes only that section: the
 * harness holds (`?hold=`) or fails (`?fail=`) one endpoint and the rest of
 * the page renders and stays usable.
 */

test('a held notifications read leaves the dashboard and the switcher usable', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard&hold=/api/v1/notifications')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: /^Switch tenant\. Current: Acme/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Notifications, count unavailable' })).toBeVisible()
})

test('a failed tenant list shows on the switcher, and the page still renders', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard&fail=/api/v1/tenants')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Switch tenant. Current: Tenants could not be loaded' })
  ).toBeVisible()
})

test('a held checklist read leaves the tenant’s details on screen', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/tenants/acme&hold=/api/v1/tenants/acme/onboarding')
  await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
  await expect(page.locator('[data-slot="query-state"][aria-busy="true"]')).toHaveCount(1)
})

test('a failed checklist read shows one error, in the checklist’s place', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/tenants/acme&fail=/api/v1/tenants/acme/onboarding')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Getting started could not be loaded.')
  await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
})

test('a failed settings read leaves the Overview card usable', async ({ page }) => {
  await page.goto(
    '/e2e/harness/?path=/settings/workspace/acme/general&fail=/api/v1/tenants/acme/settings'
  )
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
})
