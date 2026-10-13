import { expect, test } from '../hermetic'

/**
 * The settings nav's disabled Workspace items, which jsdom cannot judge: their
 * classes turn pointer events back on so hovering opens the tooltip in icon
 * mode, and cancel the hover highlight a live item has. `?state=suspended`
 * leaves the harness user no eligible tenant, so the URL names none and the
 * Workspace items are disabled.
 */

test('a disabled workspace item opens its tooltip on hover in icon mode, without a highlight', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/settings/account/profile&state=suspended')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Settings' })
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  const members = nav.getByRole('button', { name: 'Members' })
  await expect(members).toHaveAttribute('aria-disabled', 'true')
  await expect(members).toHaveAccessibleDescription('Choose a tenant first.')

  const background = await members.evaluate((element) => getComputedStyle(element).backgroundColor)
  await members.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Choose a tenant first.')
  expect(await members.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    background
  )

  // Playwright will not click an aria-disabled element unless forced; the real mouse click is the point.
  await members.click({ force: true })
  await expect(page).toHaveURL(
    (url) => url.pathname === '/settings/account/profile' && !url.searchParams.has('tenant')
  )
})

test('links the workspace items to the tenant the guard puts in the URL', async ({ page }) => {
  // The harness lists only acme, so this covers the guard's fill and the nav reading the URL, not the remembered-tenant fallback (unit-tested in tenant-in-url.test.tsx).
  await page.goto('/e2e/harness/?path=/settings/account/profile')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get('tenant') === 'acme')
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveAttribute(
    'href',
    '/settings/workspace/acme/members'
  )
  await expect(nav.getByText('Choose a tenant first.')).toHaveCount(0)
})
