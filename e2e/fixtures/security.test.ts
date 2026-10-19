import { expect, test } from '../hermetic'

/**
 * The Security page, Settings › Account › Security, through the harness, whose
 * account signs in by email link and Google and has two other sessions.
 */

test('lists the sign-in methods, email link first', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/settings/account/security')

  const methods = page
    .getByRole('list')
    .filter({ has: page.getByRole('listitem').filter({ hasText: /^Email link/ }) })
    .getByRole('listitem')
  await expect(methods).toHaveText(['Email link (a@b.com)', 'Google'])
  await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0)
})

test('signs out other sessions from the security page', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/settings/account/security')

  await page.getByRole('button', { name: 'Sign out other sessions' }).click()

  await expect(page.getByText('Signed out 2 other sessions.')).toBeVisible()
})
