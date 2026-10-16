/**
 * @file The checks jsdom cannot make, because it has no layout: an empty state
 * that renders a bare table header, and a table whose controls sit off-screen
 * on a phone. They run against the MSW harness in `e2e/harness/`, so they need
 * no backend, and `?state=` picks the members endpoint's answer.
 */
import { expect, test } from '../hermetic'

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP })

  test('loads the member list with the webfont actually applied', async ({ page }) => {
    await page.goto('/e2e/harness/')
    // Scoped to the Members region, since the pending invitations below it are a table too: header + two members.
    await expect(page.getByRole('region', { name: 'Members' }).getByRole('row')).toHaveCount(3)

    // A failed webfont load is invisible to code-reading checks (the text just falls back to sans-serif); `fonts.ready` waits out a face still loading on a cold dev server.
    const inter = await page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check('16px "Inter Variable"')
    })
    expect(inter).toBe(true)
  })

  test('says the list is empty instead of drawing a bare header', async ({ page }) => {
    await page.goto('/e2e/harness/?state=empty')
    await expect(page.getByText(/no one has access to this tenant yet/i)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Members' }).getByRole('table')).toHaveCount(0)
  })

  test('offers a retry when the member list fails, rather than a stuck skeleton', async ({
    page,
  }) => {
    await page.goto('/e2e/harness/?state=error')
    // The list query retries once (`retry: 1`, src/router.tsx) after TanStack Query's 1s default retry delay, so the error state replaces the skeleton after about 1.5s; 10s is headroom for a loaded machine. Scoped to the Members region, because the owners read fails too and its own Try again sits above the list.
    await expect(
      page.getByRole('region', { name: 'Members' }).getByRole('button', { name: 'Try again' })
    ).toBeVisible({ timeout: 10_000 })
    // `.` rather than an apostrophe: the copy uses a typographic ’ (U+2019), and an ASCII ' silently matches nothing.
    await expect(page.getByText(/could not load this tenant.s members/i)).toBeVisible()
  })

  test('lets a viewer leave from their own row, then lands on the tenant list', async ({
    page,
  }) => {
    await page.goto('/e2e/harness/?state=viewer')
    const leave = page
      .getByRole('region', { name: 'Members' })
      .getByRole('row', { name: /A B/ })
      .getByRole('button', { name: 'Leave' })
    await leave.click()

    const dialog = page.getByRole('alertdialog', { name: 'Leave this tenant?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Leave' }).click()

    await expect(page.getByText('You left this tenant.')).toBeVisible()
    await expect(page).toHaveURL(/\/tenants(\?|$)/)
  })
})

test.describe('mobile', () => {
  test.use({ viewport: MOBILE })

  test('stacks members as cards, with every control on-screen', async ({ page }) => {
    await page.goto('/e2e/harness/')
    await expect(page.getByText('Cleo D')).toBeVisible()

    // The table layout pushes Actions and the last-owner explanation past the right edge.
    await expect(page.getByRole('table')).toHaveCount(0)

    const remove = page.getByRole('button', { name: 'Remove' })
    await expect(remove).toBeInViewport()

    // Nothing may overflow the viewport: this catches a card layout regressing into a wide row.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
  })

  test('keeps a viewer’s Leave and its dialog on-screen', async ({ page }) => {
    await page.goto('/e2e/harness/?state=viewer')
    const leave = page.getByRole('button', { name: 'Leave' })
    await expect(leave).toBeInViewport()
    await leave.click()

    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Leave' })
    await expect(confirm).toBeInViewport()
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
  })

  test('shows the whole last-owner explanation, not a clipped half of it', async ({ page }) => {
    // The sole owner is the case that renders it, and on the table path this sentence would be cut mid-way at the scroll boundary.
    await page.goto('/e2e/harness/?state=soleowner')
    const reason = page.getByText(/a tenant must always have an owner/i)
    await expect(reason).toBeVisible()

    const clipped = await reason.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped).toBe(false)
  })
})
