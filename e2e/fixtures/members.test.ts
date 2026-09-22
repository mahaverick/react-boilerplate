import { expect, test } from '@playwright/test'

/**
 * The checks jsdom cannot make, because it has no layout and no cascade.
 *
 * Everything here runs against the MSW harness in `e2e/harness/`, so it needs
 * no backend. `?state=` picks which answer the members endpoint gives.
 *
 * These are the assertions behind
 * `docs/superpowers/decisions/2026-09-22-phase-b-evidence.md` — written after
 * screenshots caught two things 249 unit tests did not: an empty state that
 * rendered a bare table header, and a table whose controls sat off-screen on a
 * phone.
 */

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP })

  test('loads the member list with the webfont actually applied', async ({ page }) => {
    await page.goto('/e2e/harness/')
    await expect(page.getByRole('row')).toHaveCount(3) // header + two members

    // A silent webfont failure is the classic "looks cheap" tell and is
    // invisible to every code-reading check: the class is still there, the
    // family still resolves, and the glyphs are Times.
    const geist = await page.evaluate(() => document.fonts.check('16px "Geist Variable"'))
    expect(geist).toBe(true)
  })

  test('says the list is empty instead of drawing a bare header', async ({ page }) => {
    await page.goto('/e2e/harness/?state=empty')
    await expect(page.getByText(/no one has access to this tenant yet/i)).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('offers a retry when the member list fails, rather than a stuck skeleton', async ({
    page,
  }) => {
    await page.goto('/e2e/harness/?state=error')
    // Generous: this has to outlast TanStack Query's retry backoff before the
    // error state replaces the skeleton.
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 45_000 })
    // `.` rather than an apostrophe: the copy uses a typographic ’ (U+2019),
    // and an ASCII ' silently matches nothing.
    await expect(page.getByText(/could not load this tenant.s members/i)).toBeVisible()
  })
})

test.describe('mobile', () => {
  test.use({ viewport: MOBILE })

  test('stacks members as cards, with every control on-screen', async ({ page }) => {
    await page.goto('/e2e/harness/')
    await expect(page.getByText('Cleo D')).toBeVisible()

    // The table is what pushed Actions and the last-owner explanation past the
    // right edge; the card path exists so nothing needs horizontal scroll.
    await expect(page.getByRole('table')).toHaveCount(0)

    const remove = page.getByRole('button', { name: 'Remove' })
    await expect(remove).toBeInViewport()

    // Nothing may overflow the viewport. This is the assertion that would
    // catch a card layout regressing back into a wide row.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
  })

  test('shows the whole last-owner explanation, not a clipped half of it', async ({ page }) => {
    // The sole owner is the case that renders it, and on the table path this
    // sentence was cut mid-way at the scroll boundary.
    await page.goto('/e2e/harness/?state=soleowner')
    const reason = page.getByText(/a tenant must always have an owner/i)
    await expect(reason).toBeVisible()

    const clipped = await reason.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped).toBe(false)
  })
})
