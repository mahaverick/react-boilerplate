import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'

/**
 * The palette in a real browser: keyboard-only tenant switching and theme,
 * and a list that outgrows its `max-h-72` viewport staying
 * keyboard-scrollable and axe-clean, which jsdom (no layout) cannot show.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

/** A cold Vite transform of the palette's chunk; the contrast suite allows the same. */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/** The slice of axe's run result this file reads. */
type AxeRun = {
  violations: { id: string; nodes: { target: string[] }[] }[]
  passes: { id: string }[]
}

/**
 * Presses the shortcut and waits for the palette itself, not the "Loading
 * search…" stand-in: keys typed before the chunk mounts would go nowhere.
 */
async function openPalette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  return palette
}

test('switches tenant from the keyboard alone', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/notifications&tenants=many')
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await page.keyboard.type('beta')
  await expect(
    palette.getByRole('group', { name: 'Switch tenant' }).getByRole('option', { name: /^Beta Inc/ })
  ).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(palette).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]tenant=beta(&|$)/)
  await expect(
    page.getByRole('combobox', { name: /^Switch tenant\. Current: Beta Inc/ })
  ).toBeVisible()
})

test('lists a suspended tenant as disabled', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard&tenants=many')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await openPalette(page)
  await page.keyboard.type('gamma')
  const gamma = page.getByRole('option', { name: /^Gamma Ltd/ })
  await expect(gamma).toHaveAttribute('aria-disabled', 'true')
  await expect(gamma).toContainText('Suspended')
})

test('sets the theme from the keyboard alone', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await openPalette(page)
  await page.keyboard.type('dark')
  await expect(page.getByRole('option', { name: /^Dark/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
})

test('an overflowing palette list stays keyboard-scrollable and axe-clean', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard&tenants=many')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // The harness has too few rows to overflow the list, so each option is made taller instead.
  await page.addStyleTag({ content: '[data-slot="command-item"] { min-height: 8rem }' })

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette.getByRole('option', { name: 'Dashboard' })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // Base UI's scroll viewport: the `role="presentation"` wrapper that manages its own tabindex.
  const viewport = palette.locator('[role="presentation"][tabindex]:has([role="listbox"])')
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0)
  await expect(viewport).toHaveAttribute('tabindex', '0')

  await page.addScriptTag({ path: AXE_PATH })
  const results = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (ctx: Element, opts: unknown) => Promise<AxeRun> } }
    ).axe
    const run = await axe.run(document.querySelector('[role="dialog"]')!, {
      resultTypes: ['violations'],
    })
    return {
      violations: run.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
      ),
      passes: run.passes.map((p) => p.id),
    }
  })
  expect(results.violations).toEqual([])
  // Not vacuous: axe really evaluated a region that scrolls.
  expect(results.passes).toContain('scrollable-region-focusable')
})

test('shows the shortcut hint on the header button', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  const trigger = page.getByRole('button', { name: 'Search…' })
  await expect(trigger).toHaveText(/(⌘K|Ctrl K)$/)
  await expect(trigger).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+K$/)
})

test('Create a tenant leaves focus in the Name field of /tenants', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/dashboard')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await openPalette(page)
  await page.keyboard.type('create a tenant')
  await expect(page.getByRole('option', { name: /^Create a tenant/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/tenants(\?[^#]*)?#create$/)
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /^Name/ })).toBeFocused()
})

/**
 * Aborts the palette's chunk until `release()` is called, and counts the aborted requests.
 * Routed on the context: the harness's service worker answers page-level fetches before `page.route` sees them.
 */
async function holdPaletteChunk(page: Page) {
  const chunk = { held: true, aborted: 0 }
  await page
    .context()
    .route(/\/src\/components\/features\/command-palette\.tsx(\?|$)/, async (route) => {
      if (!chunk.held) return route.continue()
      chunk.aborted += 1
      return route.abort()
    })
  return chunk
}

test('a failed palette chunk load closes the palette and says so', async ({ page }) => {
  const chunk = await holdPaletteChunk(page)
  await page.goto('/e2e/harness/?path=/dashboard')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // The idle prefetch asks first and is refused; the open that follows is refused too.
  await expect.poll(() => chunk.aborted, { timeout: COLD_TRANSFORM_BUDGET_MS }).toBeGreaterThan(0)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByText('The command palette could not be loaded. Try again.')).toBeVisible()
  await expect(page.getByText('Loading search…')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0)
})

// Chromium caches a failed import() per document, so the second press makes no request and fails again.
test.fixme('a failed palette chunk load retries on the next shortcut press', async ({ page }) => {
  const chunk = await holdPaletteChunk(page)
  await page.goto('/e2e/harness/?path=/dashboard')
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await expect.poll(() => chunk.aborted, { timeout: COLD_TRANSFORM_BUDGET_MS }).toBeGreaterThan(0)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByText('The command palette could not be loaded. Try again.')).toBeVisible()

  chunk.held = false
  await openPalette(page)
})
