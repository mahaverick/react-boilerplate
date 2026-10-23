/**
 * @file Signing in by an emailed link and joining by an invitation, through
 * the harness on a phone-sized viewport. `?session=none` starts signed out;
 * `?link=`, `?invite=` and `?confirm=` pick what the verify, accept and
 * confirm endpoints answer. Each state also passes the 390 px overflow check,
 * which jsdom cannot make.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'

const MOBILE = { width: 390, height: 844 }

/** A token every page's schema takes: 43 base64url characters, low-entropy so no scanner reads it as a secret. */
const TOKEN = 't'.repeat(43)

/** The harness user's address, which the link and confirm answers sign in. */
const HARNESS_EMAIL = 'a@b.com'

/** The address the harness invitation is for. */
const INVITEE_EMAIL = 'invitee@b.com'

/** The harness URL mounting `path` with `query` (already `&`-joined, values encoded). */
function harness(path: string, query: string): string {
  return `/e2e/harness/?path=${path}&${query}`
}

/** The page's root element is no wider than the viewport: nothing pushes the layout sideways. */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflows, 'the page scrolls sideways at 390 px').toBe(false)
}

/** The `POST` bodies the page sent to `path`, as their parsed JSON, in order. */
function postsTo(page: Page, path: string): unknown[] {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) {
      bodies.push(request.postDataJSON())
    }
  })
  return bodies
}

test.use({ viewport: MOBILE })

test.describe('sign-in link', () => {
  test('sends a link, then shows Check your inbox with a counting-down Resend', async ({
    page,
  }) => {
    const requests = postsTo(page, '/api/v1/auth/link/request')
    // The fake clock lets the test run out the 60-second resend countdown without waiting for it.
    await page.clock.install()
    await page.goto(harness('/login', 'session=none'))
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expect(page.getByText('We sent a sign-in link to ada@example.test.')).toBeVisible()
    const resend = page.getByRole('button', { name: /^Resend in \d:\d\d/ })
    await expect(resend).toBeDisabled()
    expect(requests).toEqual([expect.objectContaining({ email: 'ada@example.test', app: 'web' })])
    await expectNoOverflow(page)

    // The countdown moves in a compiled build, and Resend opens once it runs out.
    await page.clock.fastForward('00:02')
    await expect(page.getByRole('button', { name: /^Resend in 0:5\d/ })).toBeVisible()
    await page.clock.fastForward('01:00')
    await expect(page.getByRole('button', { name: /^Resend link/ })).toBeEnabled()
  })

  test('a good link lands on the dashboard', async ({ page }) => {
    const verifies = postsTo(page, '/api/v1/auth/link/verify')
    await page.goto(
      harness('/auth/link', `session=none&link=ok&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    // The router adds `?tenant=` once the tenant list loads; the bundle is fast enough that it is there before the first check.
    await expect(page).toHaveURL(/\/dashboard(\?[^#]*)?$/)
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome back,/ })).toBeVisible()
    expect(verifies).toEqual([{ token: TOKEN, email: HARNESS_EMAIL }])
    await expectNoOverflow(page)
  })

  test('a new account lands on /welcome, and creating a workspace opens it', async ({ page }) => {
    await page.goto(
      harness('/auth/link', `session=none&link=new&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(page).toHaveURL(/\/welcome$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your workspace' })
    ).toBeVisible()
    await expectNoOverflow(page)

    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Corp')
    await page.getByRole('textbox', { name: 'Slug' }).fill('acme')
    await page.getByRole('button', { name: 'Create workspace' }).click()

    await expect(page.getByText('Acme Corp created.')).toBeVisible()
    await expect(page).toHaveURL(/\/tenants\/acme$/)
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('a dead link prefills the address, and one click sends a new link', async ({ page }) => {
    await page.goto(
      harness('/auth/link', `session=none&link=dead&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'This link expired or was already used' })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
      HARNESS_EMAIL
    )
    await expectNoOverflow(page)

    await page.getByRole('button', { name: 'Email me a new link' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('a read-only answer offers Try again, not the dead link', async ({ page }) => {
    await page.goto(
      harness('/auth/link', `session=none&link=readonly&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'We couldn’t sign you in' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(0)
    await expectNoOverflow(page)
  })
})

test.describe('invitation', () => {
  test('signed in as the invitee, the accept page joins on load', async ({ page }) => {
    const accepts = postsTo(page, '/api/v1/invitations/accept')
    await page.goto(harness('/invitations/accept', `invite=ok&token=${TOKEN}`))

    await expect(page.getByText(`You joined Acme Corp as ${HARNESS_EMAIL}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/tenants\/acme$/)
    expect(accepts).toEqual([{ token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('signed in as the invitee, a used link says you have already joined', async ({ page }) => {
    const accepts = postsTo(page, '/api/v1/invitations/accept')
    await page.goto(harness('/invitations/accept', `invite=joined&token=${TOKEN}`))

    await expect(
      page.getByText(`You’ve already joined Acme Corp as ${HARNESS_EMAIL}.`)
    ).toBeVisible()
    await expect(page).toHaveURL(/\/tenants\/acme$/)
    expect(accepts).toEqual([{ token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('an existing account gets Check your inbox, and Resend posts the same token again', async ({
    page,
  }) => {
    const verifies = postsTo(page, '/api/v1/invitations/verify')
    // The fake clock lets the test run out the 60-second resend countdown without waiting for it.
    await page.clock.install()
    await page.goto(harness('/invitations/accept', `session=none&invite=inbox&token=${TOKEN}`))

    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expect(page.getByText(`We sent a link to ${INVITEE_EMAIL}.`)).toBeVisible()
    await expect(page.getByText('Open it to join Acme Corp.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()
    await expectNoOverflow(page)

    await page.clock.fastForward('01:01')
    const resend = page.getByRole('button', { name: /^Resend link/ })
    await expect(resend).toBeEnabled()
    await resend.click()

    await expect(page.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()
    expect(verifies).toEqual([{ token: TOKEN }, { token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('a confirmation link lands in the tenant it joins', async ({ page }) => {
    const confirms = postsTo(page, '/api/v1/invitations/confirm')
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&confirm=ok&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(page.getByText(`You joined Acme Corp as ${HARNESS_EMAIL}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/tenants\/acme$/)
    expect(confirms).toEqual([{ token: TOKEN, email: INVITEE_EMAIL }])
    await expectNoOverflow(page)
  })

  test('a dead confirmation link says so and offers a sign-in link', async ({ page }) => {
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&confirm=dead&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'This link can’t be used' })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
      INVITEE_EMAIL
    )
    // The refused token leaves the address bar; the address stays for the form.
    await expect(page).not.toHaveURL(/token=/)
    await expectNoOverflow(page)
  })

  test('a read-only answer on a confirmation link offers Try again', async ({ page }) => {
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&confirm=readonly&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'We couldn’t add you to your team' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('signed in as someone else, a confirmation link asks before switching', async ({ page }) => {
    const confirms = postsTo(page, '/api/v1/invitations/confirm')
    await page.goto(
      harness('/invitations/confirm', `confirm=ok&token=${TOKEN}&email=${INVITEE_EMAIL}`)
    )

    await expect(page.getByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Continue as ${INVITEE_EMAIL}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(confirms).toEqual([])
    await expectNoOverflow(page)
  })
})
