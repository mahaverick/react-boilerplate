/**
 * @file Passkeys against a real express: sign in by link, create a passkey in
 * Settings › Security, sign out, then sign in with the passkey button. Chrome's
 * virtual authenticator holds the passkey. It needs an express on the
 * `feat/passkeys` code with passkeys `optional` or `required` and its relying
 * party id `localhost`, so it is skipped unless `E2E_LIVE=1`; run it with
 * `pnpm test:e2e:live`. It calls no helper that starts or stops a process.
 */
import { expect, test } from '@playwright/test'
import { addVirtualAuthenticator } from '../helpers/virtual-authenticator'
import { API_ORIGIN, apiIsReady, createUser, freshEmail, logIn } from './helpers'

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start express on the passkeys code first: pnpm db:migrate && pnpm dev`
    )
  }
  const response = await fetch(`${API_ORIGIN}/api/v1/auth/passkeys/config`)
  if (response.status === 404) {
    throw new Error(
      `The API at ${API_ORIGIN} has no passkey routes. Run express from feat/passkeys.`
    )
  }
})

test('creates a passkey, signs out and signs back in with it', async ({ page }) => {
  const email = freshEmail()
  await createUser(email)
  const auth = await addVirtualAuthenticator(page)

  await logIn(page, email)
  await page.goto('/settings/account/security')
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible()

  // The link sign-in is recent, so creating needs no confirmation dialog.
  await page.getByRole('button', { name: 'Create a passkey' }).click()
  await expect(page.getByText('Passkey created.')).toBeVisible()
  // A toast is a Base UI dialog too, so only the Confirm it's you dialog counts.
  await expect(page.getByRole('dialog', { name: /Confirm it/ })).toHaveCount(0)
  expect(await auth.credentials()).toHaveLength(1)

  await page.getByRole('button', { name: /Account menu for/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page).toHaveURL(/\/(dashboard|welcome)/, { timeout: 15_000 })
  await auth.remove()
})
