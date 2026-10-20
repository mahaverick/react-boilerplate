/**
 * @file Passkeys through the harness, in Chrome with a virtual authenticator:
 * sign-in, "Confirm it's you", the Security section and required mode. The
 * harness answers the contract's calls (`?passkeys=`, `?passkeyList=`,
 * `?stepUp=`, `?setup=1`) and does not check a signature; what the browser
 * builds and signs is real.
 */
import type { Page } from '@playwright/test'
import { USER_HANDLE } from '../../tests/fixtures/user-handle'
import { addVirtualAuthenticator } from '../helpers/virtual-authenticator'
import { expect, test } from '../hermetic'

/** The harness URL for `path` with `query` (already `&`-joined). */
function harness(path: string, query = ''): string {
  return `/e2e/harness/?path=${path}${query ? `&${query}` : ''}`
}

/** The page's root element is no wider than the viewport. */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflows, 'the page scrolls sideways').toBe(false)
}

/** The JSON bodies the page POSTed to `path`, in order. */
function postsTo(page: Page, path: string): unknown[] {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) {
      bodies.push(request.postDataJSON())
    }
  })
  return bodies
}

test('signs in with the passkey button and lands on the dashboard', async ({ page }) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  await page.goto('/e2e/harness/?session=none&path=/login')

  const verify = page.waitForRequest('**/auth/passkeys/sign-in/verify')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

  expect((await verify).postDataJSON()).toMatchObject({
    app: 'web',
    response: { type: 'public-key' },
  })
  await expect(page).toHaveURL(/\/dashboard/)
})

test('mode off shows no passkey button on sign-in and no Passkeys section in Security', async ({
  page,
}) => {
  const listed: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/passkeys') listed.push(request.method())
  })
  const config = page.waitForResponse('**/auth/passkeys/config')
  await page.goto(harness('/login', 'session=none&passkeys=off'))
  await config
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0)

  const securityConfig = page.waitForResponse('**/auth/passkeys/config')
  await page.goto(harness('/settings/account/security', 'passkeys=off'))
  await securityConfig
  await expect(page.getByRole('button', { name: 'Sign out other sessions' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toHaveCount(0)
  expect(listed, 'the list is never read in mode off').toEqual([])
})

test('creates a passkey after Confirm it’s you by passkey (stepUp=stale)', async ({ page }) => {
  const auth = await addVirtualAuthenticator(page)
  const seeded = await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  const confirms = postsTo(page, '/api/v1/auth/passkeys/step-up/verify')
  const registrations = postsTo(page, '/api/v1/auth/passkeys/registration/verify')
  await page.goto(harness('/settings/account/security', 'stepUp=stale&passkeyList=one'))
  await expect(page.getByRole('listitem').filter({ hasText: 'MacBook Touch ID' })).toBeVisible()

  await page.getByRole('button', { name: 'Create a passkey' }).click()

  await expect(page.getByText('Passkey created.')).toBeVisible()
  expect(confirms).toEqual([
    expect.objectContaining({ challengeId: 'harness-step-up', response: expect.any(Object) }),
  ])
  expect(confirms[0]).not.toHaveProperty('app')
  expect(registrations).toEqual([
    expect.objectContaining({
      challengeId: 'harness-registration',
      app: 'web',
      response: expect.objectContaining({ type: 'public-key' }),
    }),
  ])
  await expect(page.getByRole('listitem').filter({ hasText: 'Passkey 3' })).toBeVisible()
  // One user handle holds one resident credential per site, so the new passkey replaced the seeded one.
  const held = await auth.credentials()
  expect(held).toHaveLength(1)
  expect(held[0]!.credentialId).not.toBe(seeded)
})

test('Confirm it’s you → Use another method shows Email me a link', async ({ page }) => {
  // No credential on the authenticator: the automatic prompt ends without a passkey.
  await addVirtualAuthenticator(page)
  await page.goto(harness('/settings/account/security', 'stepUp=stale&passkeyList=one'))

  await page.getByRole('button', { name: 'Create a passkey' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Use another method' }).click()

  await expect(dialog.getByRole('button', { name: 'Email me a link' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Use your passkey instead' })).toBeVisible()
})

test('deletes a passkey and refuses the last one in required mode', async ({ page }) => {
  await page.goto(harness('/settings/account/security'))
  const first = page.getByRole('listitem').filter({ hasText: 'MacBook Touch ID' })
  await expect(first).toBeVisible()

  await page.getByRole('button', { name: 'Delete MacBook Touch ID' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete “MacBook Touch ID”?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete passkey' }).click()
  await expect(page.getByText('Passkey deleted.')).toBeVisible()
  await expect(first).toHaveCount(0)

  // Required mode, one passkey: the dialog refuses and offers only Close.
  await page.goto(harness('/settings/account/security', 'passkeys=required&passkeyList=one'))
  await page.getByRole('button', { name: 'Delete MacBook Touch ID' }).click()
  const refusal = page.getByRole('alertdialog', { name: 'Delete “MacBook Touch ID”?' })
  await expect(
    refusal.getByText(
      'Create another passkey before you delete this one. Your account needs at least one.'
    )
  ).toBeVisible()
  await expect(refusal.getByRole('button', { name: 'Delete passkey' })).toHaveCount(0)
  await refusal.getByRole('button', { name: 'Close' }).click()
  await expect(refusal).toHaveCount(0)
})

test('required mode shows Create your passkey and, after creating, the page the user opened (setup=1)', async ({
  page,
}) => {
  await addVirtualAuthenticator(page)
  await page.goto(harness('/dashboard', 'passkeys=required&setup=1'))

  await expect(page.getByRole('heading', { level: 1, name: 'Create your passkey' })).toBeVisible()
  await expect(
    page.getByText('Create a passkey to continue. Every account here needs one.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.getByRole('button', { name: 'Create a passkey' }).click()

  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your passkey' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/dashboard/)
})

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the setup screen and the passkey dialogs fit 390px wide with no horizontal scroll', async ({
    page,
  }) => {
    await page.goto(harness('/dashboard', 'passkeys=required&setup=1'))
    await expect(page.getByRole('heading', { level: 1, name: 'Create your passkey' })).toBeVisible()
    await expectNoOverflow(page)

    await page.goto(harness('/settings/account/security'))
    await expect(page.getByRole('listitem').filter({ hasText: 'Work security key' })).toBeVisible()
    await expectNoOverflow(page)

    await page.getByRole('button', { name: 'Rename Work security key' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename passkey' })
    await expect(rename).toBeVisible()
    await expectNoOverflow(page)
    expect((await rename.boundingBox())!.width).toBeLessThanOrEqual(390)
    await rename.getByRole('button', { name: 'Cancel' }).click()
    await expect(rename).toHaveCount(0)

    await page.getByRole('button', { name: 'Delete Work security key' }).click()
    const remove = page.getByRole('alertdialog', { name: 'Delete “Work security key”?' })
    await expect(remove).toBeVisible()
    await expectNoOverflow(page)
    expect((await remove.boundingBox())!.width).toBeLessThanOrEqual(390)
  })

  test('the Confirm it’s you dialog fits 390px wide', async ({ page }) => {
    await page.goto(harness('/settings/account/security', 'stepUp=stale&passkeyList=none'))
    await page.getByRole('button', { name: 'Create a passkey' }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' })
    await expect(dialog.getByRole('button', { name: 'Email me a link' })).toBeVisible()
    await expectNoOverflow(page)
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390)
  })
})
