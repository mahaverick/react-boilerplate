import { expect, test, type Page } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  createTenant,
  createVerifiedUser,
  freshEmail,
  freshSlug,
  grantPlatformRole,
  logIn,
} from './helpers'

/**
 * Staff reach a tenant they are not a member of, act at
 * exactly their platform role, and are seen doing it. Needs express 3.1.0 or
 * later on :4040 (migration 0016, `pnpm platform:grant`), so it is skipped
 * unless `E2E_LIVE=1`. Run it with `pnpm test:e2e:live`.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start express 3.1.0+ first: cd ../express-boilerplate && pnpm db:migrate && pnpm dev`
    )
  }
})

/** An owner with one fresh tenant, set up entirely through the API. */
async function ownerWithTenant(): Promise<{ owner: string; name: string; slug: string }> {
  const owner = freshEmail()
  await createVerifiedUser(owner)
  const slug = freshSlug()
  const name = `E2E ${slug}`
  await createTenant(await apiLogin(owner), { name, slug })
  return { owner, name, slug }
}

/** A verified account holding `role` in the platform tenant, signed in on `page`. */
async function staffSignedIn(page: Page, role: 'viewer' | 'admin'): Promise<string> {
  const staff = freshEmail()
  await createVerifiedUser(staff)
  await grantPlatformRole(staff, role)
  await logIn(page, staff)
  return staff
}

test('a staff viewer finds a tenant by search, is told so, and cannot change it', async ({
  page,
}) => {
  const { name, slug } = await ownerWithTenant()
  const staff = await staffSignedIn(page, 'viewer')

  // The All tenants group only exists for staff, which proves `platformRole`
  // reached the SPA with the sign-in itself (no reload happened).
  await page.getByRole('combobox', { name: /^Switch tenant/ }).click()
  await page.getByLabel('Search tenants').fill(slug)
  const all = page.getByRole('group', { name: 'All tenants' })
  await all.getByRole('option', { name }).click()

  await expect(page).toHaveURL(new RegExp(`/tenants/${slug}$`))
  const banner = page.getByRole('status').filter({ hasText: 'as platform staff' })
  await expect(banner).toContainText(`You’re viewing ${name} as platform staff (Viewer).`)
  await expect(banner.getByRole('link', { name: 'Back to your tenants' })).toBeVisible()

  // Edit controls are ABSENT for a viewer here: the read-only views render.
  await expect(
    page.getByText('These details are managed by the tenant’s owners and admins.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Tenant sections' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(
    page.getByText('These settings are managed by the tenant’s owners and admins.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)

  // And the API agrees, whatever the UI shows: the effective role is viewer.
  const patched = await apiRequest(await apiLogin(staff), 'PATCH', `/tenants/${slug}`, {
    name: 'Changed by a staff viewer',
  })
  expect(patched.status).toBe(403)
})

test('a staff admin changes a setting, and the owner sees it in Activity marked Staff', async ({
  page,
  browser,
}) => {
  const { owner, slug } = await ownerWithTenant()
  await staffSignedIn(page, 'admin')

  await page.goto(`/tenants/${slug}/settings`)
  await expect(
    page.getByRole('status').filter({ hasText: 'as platform staff (Admin)' })
  ).toBeVisible()
  const timezone = page.getByLabel('Timezone')
  await timezone.fill('Asia/Tokyo')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings updated.')).toBeVisible()

  // The owner, in a browser of their own: a separate cookie jar and session.
  const ownerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const ownerPage = await ownerContext.newPage()
    await logIn(ownerPage, owner)
    await ownerPage.goto(`/tenants/${slug}/activity`)

    const row = ownerPage.getByRole('listitem').filter({ hasText: 'changed the settings' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('timezone')
    await expect(row.getByText('Staff', { exact: true })).toBeVisible()

    // The owner's own action is theirs, and is not badged.
    const created = ownerPage.getByRole('listitem').filter({ hasText: 'created the tenant' })
    await expect(created.getByText('Staff', { exact: true })).toHaveCount(0)
  } finally {
    await ownerContext.close()
  }
})
