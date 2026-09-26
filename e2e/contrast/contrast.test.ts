import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

/**
 * COLOUR CONTRAST, measured.
 *
 * `tests/unit/a11y.test.tsx` disables every `cat.color` rule, and says so in its
 * header: jest-axe turns them off by default under jsdom because jsdom has no
 * layout and no cascade, so a contrast ratio cannot be computed there at all.
 * A green run of the a11y gate therefore says **nothing** about contrast, and
 * the Phase B renders only made it *visible*, not *checked*.
 *
 * A real browser can compute it. This suite injects the same axe-core the unit
 * gate uses — already a devDependency, no new package — and runs the one rule
 * that needs pixels, in both themes.
 *
 * Deliberately NOT in CI and not part of `pnpm test`: run it with
 * `pnpm test:contrast` when tokens or surfaces change. Contrast is a property
 * of the palette, which moves rarely and deliberately.
 */

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

/**
 * Every surface reachable without a backend, with a selector proving the page
 * actually rendered.
 *
 * `expect` is not optional decoration. A route that silently redirected — an
 * authenticated page losing its session, a `validateSearch` rejecting a token
 * and bouncing to /login — would still produce a fully painted page with
 * perfectly good contrast, and this suite would report it green while
 * measuring something else entirely. Each entry therefore names something only
 * THAT surface renders, asserted before axe runs.
 *
 * The `/e2e/harness/` entries mount an in-app route with MSW answering and the
 * auth store pre-populated (e2e/harness/harness.tsx). `?path=` picks which
 * route; without it the harness mounts the members page, which is what the
 * `?state=` fixtures are about.
 */
const SURFACES = [
  // Public — straight URLs, no harness needed.
  { name: 'sign-in', url: '/login', heading: 'Sign in' },
  { name: 'register', url: '/register', heading: 'Create an account' },
  { name: 'forgot-password', url: '/forgot-password', heading: 'Forgot your password?' },
  // Both of these routes read a token out of the query. Without one,
  // reset-password renders its "This link is incomplete" branch instead —
  // a real surface, but not the one worth measuring, and the heading
  // assertion is what keeps that swap from passing unnoticed.
  {
    name: 'reset-password',
    url: '/reset-password?token=contrast-probe',
    heading: 'Choose a new password',
  },
  {
    name: 'verify-email',
    url: '/verify-email?token=contrast-probe',
    heading: 'Verify your email',
  },
  // Authenticated — mounted through the harness.
  { name: 'members (populated)', url: '/e2e/harness/', heading: 'Members' },
  { name: 'members (empty)', url: '/e2e/harness/?state=empty', heading: 'Members' },
  { name: 'dashboard', url: '/e2e/harness/?path=/dashboard', heading: /^Welcome back,/ },
  { name: 'notifications', url: '/e2e/harness/?path=/notifications', heading: 'Notifications' },
  { name: 'profile', url: '/e2e/harness/?path=/profile', heading: 'Profile' },
  { name: 'tenants', url: '/e2e/harness/?path=/tenants', heading: 'Tenants' },
  {
    name: 'tenant settings',
    url: '/e2e/harness/?path=/tenants/acme/settings',
    heading: 'Settings',
  },
  {
    name: 'tenant activity',
    url: '/e2e/harness/?path=/tenants/acme/activity',
    heading: 'Activity',
  },
] as const

const THEMES = ['light', 'dark'] as const

type ContrastResult = {
  violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
  incomplete: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
}

async function contrastOf(
  page: Page,
  url: string,
  theme: string,
  heading: string | RegExp,
  scope?: string
): Promise<ContrastResult> {
  // Set BEFORE the document runs: index.html loads a pre-paint script that
  // reads localStorage and toggles `.dark` before the bundle loads, so setting
  // the theme afterwards would measure a repaint rather than the real render.
  await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
  await page.goto(url, { waitUntil: 'networkidle' })
  // Prove the surface we asked for is the surface we got, BEFORE measuring it.
  // A route that redirected — an authenticated page without a session, a
  // `validateSearch` rejecting the probe token — still paints a perfectly
  // legible page, so contrast over it would come back green while saying
  // nothing about the surface this entry names.
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()

  await page.evaluate(() => document.fonts.ready)
  // Fonts change glyph coverage, not colour, but a late swap can move text over
  // a different background. Settle before sampling.
  await page.waitForTimeout(400)

  await page.addScriptTag({ path: AXE_PATH })

  return runAxe(page, scope)
}

/**
 * Run axe's contrast rule over the whole document, or over one element.
 *
 * Scoping matters for the popup surfaces: the page behind an open menu is
 * already graded by its own entry above, so running the whole document again
 * would report the same nodes twice and make a popup failure harder to see,
 * not easier.
 * @param page - The page, with axe already injected.
 * @param scope - A selector to grade instead of the whole document.
 * @returns axe's violations and incompletes.
 */
async function runAxe(page: Page, scope?: string): Promise<ContrastResult> {
  return page.evaluate(async (selector) => {
    // `color-contrast` ONLY. Everything else about these pages is already
    // gated by tests/unit/a11y.test.tsx, and re-running it here would mean two
    // sources of truth for the same finding.
    const results = await (
      window as unknown as {
        axe: { run: (ctx: Document | Element, opts: unknown) => Promise<ContrastResult> }
      }
    ).axe.run((selector ? document.querySelector(selector) : document) ?? document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations'],
    })
    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
      incomplete: results.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
    }
  }, scope)
}

/** axe's failureSummary carries the ratio and both colours; keep it readable. */
function report(surface: string, theme: string, result: ContrastResult): string {
  const lines: string[] = []
  for (const violation of result.violations) {
    for (const node of violation.nodes) {
      lines.push(`  ✘ ${node.target.join(' ')}`)
      for (const detail of (node.failureSummary ?? '').split('\n')) {
        if (detail.trim() && !detail.startsWith('Fix any')) lines.push(`      ${detail.trim()}`)
      }
    }
  }
  return lines.length ? `${surface} · ${theme}\n${lines.join('\n')}` : ''
}

for (const theme of THEMES) {
  for (const surface of SURFACES) {
    test(`${surface.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(page, surface.url, theme, surface.heading)

      // `incomplete` is not a pass. axe files a node here when it cannot
      // resolve the background — a gradient, an image, an overlapped element —
      // and those are exactly the cases a human has to look at. Surfaced
      // rather than asserted, because a false alarm here should not block.
      if (result.incomplete.length > 0) {
        const targets = result.incomplete.flatMap((i) => i.nodes.map((n) => n.target.join(' ')))
        console.warn(
          `[contrast] ${surface.name} · ${theme}: ${targets.length} node(s) axe could not resolve — check by eye:\n  ${targets.join('\n  ')}`
        )
      }

      expect(report(surface.name, theme, result), report(surface.name, theme, result)).toBe('')
    })
  }
}

/**
 * Popup surfaces — menus, the mobile sheet, and the destructive confirm.
 *
 * These carry their own `--popover` / `--popover-foreground` pair (and the
 * sheet its own background), so a failure on one is invisible to every page
 * test above: axe only sees what is in the DOM, and a closed menu is not.
 * That makes them the surfaces most likely to hide a bad token pair, and the
 * ones a palette change is least likely to be checked against by eye.
 *
 * Selectors are ported from `tests/unit/a11y.test.tsx`'s "open overlays" and
 * menu blocks, which already drive each of these open — deliberately reused
 * rather than reinvented, so the two suites cannot drift on what "the user
 * menu" means.
 */
const POPUPS = [
  {
    name: 'notification bell menu',
    path: '/dashboard',
    trigger: /^Notifications,/,
    triggerRole: 'button',
    role: 'menu',
    itemRole: 'menuitem',
  },
  {
    name: 'tenant switcher',
    path: '/dashboard',
    trigger: /^Switch tenant/,
    triggerRole: 'combobox',
    role: 'dialog',
    itemRole: 'option',
  },
  {
    name: 'user menu',
    path: '/dashboard',
    trigger: /^Account menu for/,
    triggerRole: 'button',
    role: 'menu',
    itemRole: 'menuitem',
  },
] as const

for (const theme of THEMES) {
  for (const popup of POPUPS) {
    test(`${popup.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto(`/e2e/harness/?path=${popup.path}`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible()

      await page.getByRole(popup.triggerRole, { name: popup.trigger }).click()
      const menu = page.getByRole(popup.role)
      await expect(menu).toBeVisible()
      // A menu that opened EMPTY would grade clean while saying nothing about
      // the items this test exists for — the same guard the a11y gate states
      // for its own menu block.
      await expect(menu.getByRole(popup.itemRole).first()).toBeVisible()

      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(300)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, `[role="${popup.role}"]`)
      expect(report(popup.name, theme, result), report(popup.name, theme, result)).toBe('')
    })
  }
}

test.describe('popups that are not menus', () => {
  for (const theme of THEMES) {
    test(`the mobile navigation sheet meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // The sheet carries its own background token, and it only exists below
      // the desktop breakpoint — so the desktop shell tests above can never
      // reach it however many pages they visit.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/dashboard', { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible()

      await page.getByRole('button', { name: 'Toggle sidebar' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      // Opened AND populated: an empty sheet grades clean and proves nothing.
      await expect(sheet.getByRole('link').first()).toBeVisible()

      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(300)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="dialog"]')
      expect(report('mobile sheet', theme, result), report('mobile sheet', theme, result)).toBe('')
    })

    test(`the remove-member confirm meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // The one place a `destructive` foreground lands on a raised surface.
      // Every other destructive control in the app sits on the page
      // background, which the page entries above already cover.
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/', { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

      // Cleo is a plain member and not the last owner, so her row's control is
      // the enabled one — the same row tests/unit/a11y.test.tsx drives for the
      // same reason.
      const row = page.getByRole('row').filter({ hasText: 'Cleo' })
      await row.getByRole('button', { name: 'Remove' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(confirm.getByRole('button', { name: /Remove/ })).toBeVisible()

      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(300)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('remove-member confirm', theme, result),
        report('remove-member confirm', theme, result)
      ).toBe('')
    })
  }
})

/**
 * The staff surfaces: the banner a staff member sees on a tenant they reached
 * through platform access, and the Staff badge on an Activity row. Each is
 * asserted present, because a page without it grades clean and proves nothing
 * about it.
 */
test.describe('staff surfaces', () => {
  for (const theme of THEMES) {
    test(`the platform access banner meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(
        page,
        '/e2e/harness/?path=/tenants/acme&access=platform',
        theme,
        'Acme Corp'
      )
      await expect(
        page.getByRole('status').filter({ hasText: 'as platform staff (Viewer)' })
      ).toBeVisible()
      expect(report('staff banner', theme, result), report('staff banner', theme, result)).toBe('')
    })

    test(`the Activity Staff badge meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(
        page,
        '/e2e/harness/?path=/tenants/acme/activity',
        theme,
        'Activity'
      )
      const row = page.getByRole('listitem').filter({ hasText: 'Sam Staff' })
      await expect(row.getByText('Staff', { exact: true })).toBeVisible()
      expect(report('staff badge', theme, result), report('staff badge', theme, result)).toBe('')
    })
  }
})
