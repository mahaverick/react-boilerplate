import { expect, test } from '@playwright/test'

/**
 * The Security section on /profile, through the harness. The harness accepts
 * one current password, `current-password`, and answers anything else with
 * the API's own 400.
 */

test('changes the password from the profile page', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/profile')

  const current = page.getByLabel('Current password')
  await current.fill('current-password')
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password')
  await page.getByLabel('Confirm new password').fill('a-brand-new-password')
  await page.getByRole('button', { name: 'Change password' }).click()

  await expect(page.getByText('Password changed. Other sessions were signed out.')).toBeVisible()
  await expect(current).toHaveValue('')
})

test('puts a wrong current password on its own field', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/profile')

  const current = page.getByLabel('Current password')
  await current.fill('not-the-password')
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password')
  await page.getByLabel('Confirm new password').fill('a-brand-new-password')
  await page.getByRole('button', { name: 'Change password' }).click()

  await expect(current).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Current password is incorrect.')).toHaveCount(1)
})
