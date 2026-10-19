/**
 * @file Measures colour contrast with axe's `color-contrast` rule in a real
 * browser, in both themes, over every surface reachable without a backend and
 * over the popups, which jsdom cannot do (no layout), so a green
 * `tests/unit/a11y.test.tsx` says nothing about contrast. It is opt-in
 * (`pnpm test:contrast`) and not in CI: run it before merging UI work, since
 * component composition can break contrast as well as a palette change. `test`
 * comes from `../hermetic`, which answers every `/api` request that would
 * leave the browser with a 401, so no page's session bootstrap can reach
 * whatever runs on :4040, nor hang on it while it restarts.
 */
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'
import { afterAnimations, afterFontsAndFrames } from '../timing'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

/**
 * The dev server transforms a lazily loaded route's modules on first request,
 * which has taken over 7s under load, after `goto` has already resolved on
 * `load`. It stays below the 30s test timeout, so a hang fails the heading
 * assertion.
 */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/**
 * Every surface reachable without a backend. Each entry's `heading` is
 * something only that surface renders, asserted before axe runs: a route that
 * silently redirected (an authenticated page losing its session, a
 * `validateSearch` rejecting a token and bouncing to /login) still paints a
 * legible page, and the suite would report it green while measuring something
 * else.
 *
 * The `/e2e/harness/` entries mount an in-app route with MSW answering and the
 * auth store pre-populated (e2e/harness/harness.tsx); `?path=` picks the route.
 */
const SURFACES = [
  { name: 'sign-in', url: '/login', heading: 'Sign in' },
  // The harness's default page is Settings › Workspace › Members. Its layout's h1 is also "Members", and renders whatever the tenant gate decides, so the panel's own h2 is the one waited for.
  { name: 'members (populated)', url: '/e2e/harness/', heading: { name: 'Members', level: 2 } },
  {
    name: 'members (empty)',
    url: '/e2e/harness/?state=empty',
    heading: { name: 'Members', level: 2 },
  },
  { name: 'dashboard', url: '/e2e/harness/?path=/dashboard', heading: /^Welcome back,/ },
  { name: 'notifications', url: '/e2e/harness/?path=/notifications', heading: 'Notifications' },
  {
    name: 'settings',
    url: '/e2e/harness/?path=/settings',
    heading: { name: 'Workspace', level: 2 },
  },
  // No eligible tenant, so the Workspace rows render as muted text under the "Choose a tenant first." hint.
  {
    name: 'settings (no tenant)',
    url: '/e2e/harness/?path=/settings&state=suspended',
    heading: { name: 'Workspace', level: 2 },
  },
  {
    name: 'profile',
    url: '/e2e/harness/?path=/settings/account/profile',
    heading: { name: 'Details', level: 2 },
  },
  {
    name: 'security',
    url: '/e2e/harness/?path=/settings/account/security',
    heading: 'Sign-in methods',
  },
  {
    name: 'notification settings',
    url: '/e2e/harness/?path=/settings/account/notifications',
    heading: 'Preferences',
  },
  { name: 'tenants', url: '/e2e/harness/?path=/tenants', heading: 'Tenants' },
  {
    name: 'tenants (suspended row)',
    url: '/e2e/harness/?path=/tenants&state=suspended',
    heading: 'Tenants',
  },
  {
    name: 'tenant suspended panel',
    url: '/e2e/harness/?path=/tenants/acme&state=suspended',
    heading: 'Tenant suspended',
  },
  {
    name: 'tenant overview (getting started)',
    url: '/e2e/harness/?path=/tenants/acme',
    heading: 'Getting started',
  },
  {
    name: 'workspace general',
    url: '/e2e/harness/?path=/settings/workspace/acme/general',
    heading: { name: 'Settings', level: 2 },
  },
  {
    name: 'workspace activity',
    url: '/e2e/harness/?path=/settings/workspace/acme/activity',
    heading: { name: 'Activity', level: 2 },
  },
  {
    name: 'dashboard template (tenant list loading)',
    url: '/e2e/harness/?path=/dashboard&hold=/api/v1/tenants',
    heading: { loading: 'template' },
  },
  {
    name: 'tenant detail template (tenant loading)',
    url: '/e2e/harness/?path=/tenants/acme&hold=/api/v1/tenants/acme',
    heading: { loading: 'template' },
  },
  {
    name: 'dashboard (tenant list failed)',
    url: '/e2e/harness/?path=/dashboard&fail=/api/v1/tenants',
    heading: { name: /^Welcome back,/, level: 1 },
  },
  {
    name: 'tenant overview (checklist loading)',
    url: '/e2e/harness/?path=/tenants/acme&hold=/api/v1/tenants/acme/onboarding',
    heading: { loading: 'section', heading: { name: 'Details', level: 2 } },
  },
  {
    name: 'tenant overview (checklist failed)',
    url: '/e2e/harness/?path=/tenants/acme&fail=/api/v1/tenants/acme/onboarding',
    heading: { name: 'Details', level: 2 },
  },
  {
    name: 'security (methods loading)',
    url: '/e2e/harness/?path=/settings/account/security&hold=/api/v1/auth/providers',
    heading: { loading: 'section', heading: { name: 'Security', level: 1 } },
  },
] as const

/** What `contrastOf` waits for: a heading's name, or its name and level where the name alone is not unique. */
type Heading = string | RegExp | { name: string | RegExp; level: number }

/** The `getByRole('heading', …)` options for `heading`. */
function headingOptions(heading: Heading): { name: string | RegExp; level?: number } {
  return typeof heading === 'string' || heading instanceof RegExp ? { name: heading } : heading
}

/**
 * A surface graded while it loads: `template` waits for the route template's
 * `status` region named "Loading", `section` for a busy section's skeleton,
 * each under `heading` when the state renders one. Neither waits for the
 * skeletons to go: they are what is graded.
 */
type LoadingWait = { loading: 'template' | 'section'; heading?: Heading }

/** What `contrastOf` waits for: a loaded surface's heading, or a loading state. */
type Wait = Heading | LoadingWait

/** Whether `wait` names a loading state rather than a loaded heading. */
function isLoadingWait(wait: Wait): wait is LoadingWait {
  return typeof wait === 'object' && !(wait instanceof RegExp) && 'loading' in wait
}

const THEMES = ['light', 'dark'] as const

/** The part of axe's output the suite reads: the nodes that fail the rule, and those axe could not decide. */
type ContrastResult = {
  violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
  incomplete: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
}

/**
 * Loads `url` in `theme`, waits until the surface `wait` names has rendered:
 * with its data, or in the loading state it names. Returns axe's contrast
 * result for it.
 *
 * The theme goes into localStorage before the document runs because
 * index.html's pre-paint script reads it and toggles `.dark` before the bundle
 * loads; setting it afterwards would measure a repaint. The heading is asserted
 * before measuring because a route that redirected still paints a legible page
 * and would come back green.
 */
async function contrastOf(
  page: Page,
  url: string,
  theme: string,
  wait: Wait,
  scope?: string
): Promise<ContrastResult> {
  await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
  await page.goto(url)
  if (isLoadingWait(wait)) {
    if (wait.heading) {
      await expect(page.getByRole('heading', headingOptions(wait.heading))).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })
    }
    const loading =
      wait.loading === 'template'
        ? page.getByRole('status', { name: 'Loading' })
        : page.locator('[data-slot="query-state"][aria-busy="true"] [data-slot="skeleton"]')
    await expect(loading.first()).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  } else {
    await expect(page.getByRole('heading', headingOptions(wait))).toBeVisible({
      timeout: COLD_TRANSFORM_BUDGET_MS,
    })
    // The heading can render outside each page's data conditional, so it can show while the data behind it is still a skeleton. Grade the loaded page.
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
  }

  // A late font swap can move text over a different background, so sample once it has reflowed.
  await afterFontsAndFrames(page)

  await page.addScriptTag({ path: AXE_PATH })

  return runAxe(page, scope)
}

/**
 * Runs axe's contrast rule over the whole document, or over one element.
 *
 * Scoping matters for the popups: the page behind an open menu is graded by its
 * own entry, so running the whole document would report the same nodes twice
 * and bury a popup failure.
 * @param page - The page, with axe already injected.
 * @param scope - A selector to grade instead of the whole document.
 * @returns axe's violations and incompletes.
 */
async function runAxe(page: Page, scope?: string): Promise<ContrastResult> {
  return page.evaluate(async (selector) => {
    // `color-contrast` only: tests/unit/a11y.test.tsx gates every other rule, and re-running them here would give two sources of truth.
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

/** Formats the failing nodes with the ratio and colours from axe's `failureSummary`, or an empty string when none fail. */
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

      // `incomplete` is not a pass: axe files a node there when it cannot resolve the background (a gradient, an image, an overlap), so it is surfaced for a human rather than asserted.
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
 * The menus and the tenant switcher, opened and graded at their popup. Each
 * carries its own `--popover` / `--popover-foreground` pair, so a bad token pair
 * there is invisible to the page entries: axe only sees what is in the DOM, and
 * a closed popup is not. The triggers and roles follow `tests/unit/a11y.test.tsx`'s
 * menu blocks, so the two suites agree on what each popup is.
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
      await page.goto(`/e2e/harness/?path=${popup.path}`)
      await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole(popup.triggerRole, { name: popup.trigger }).click()
      const menu = page.getByRole(popup.role)
      await expect(menu).toBeVisible()
      // A menu that opened empty would grade clean without testing its items.
      await expect(menu.getByRole(popup.itemRole).first()).toBeVisible()

      await afterAnimations(menu)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, `[role="${popup.role}"]`)
      expect(report(popup.name, theme, result), report(popup.name, theme, result)).toBe('')
    })
  }
}

test.describe('popups that are not menus', () => {
  for (const theme of THEMES) {
    test(`the mobile navigation sheet meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // The sheet carries its own background token and exists only below the desktop breakpoint, so the desktop tests above never reach it.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/dashboard')
      await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole('button', { name: 'Toggle sidebar' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      // An empty sheet would grade clean and prove nothing.
      await expect(sheet.getByRole('link').first()).toBeVisible()

      await afterAnimations(sheet)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="dialog"]')
      expect(report('mobile sheet', theme, result), report('mobile sheet', theme, result)).toBe('')
    })

    test(`the remove-member confirm meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // Puts the `destructive` foreground on the dialog's raised surface, which the page entries never open.
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/')
      await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      // Cleo is a plain member and not the last owner, so her row's Remove is the enabled one.
      const row = page
        .getByRole('region', { name: 'Members' })
        .getByRole('row')
        .filter({ hasText: 'Cleo' })
      await row.getByRole('button', { name: 'Remove' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(confirm.getByRole('button', { name: /Remove/ })).toBeVisible()

      await afterAnimations(confirm)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('remove-member confirm', theme, result),
        report('remove-member confirm', theme, result)
      ).toBe('')
    })

    test(`the list toolbar, a facet popover, its chips and the column menu meet WCAG AA contrast in ${theme}`, async ({
      page,
    }) => {
      // The facet popover, the chip row and the column menu carry their own tokens, and no page entry opens them.
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/')
      await expect(page.getByRole('table', { name: 'Members' })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      const members = page.getByRole('region', { name: 'Members' })
      await members.getByRole('button', { name: 'Filter by role, Members' }).click()
      const facet = page.getByRole('dialog', { name: 'Filter by role, Members' })
      await expect(facet.getByRole('checkbox').first()).toBeVisible()
      await afterAnimations(facet)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })
      const popup = await runAxe(page, '[role="dialog"]')
      expect(report('facet popover', theme, popup), report('facet popover', theme, popup)).toBe('')

      await facet.getByRole('checkbox', { name: 'Owner' }).click()
      await page.keyboard.press('Escape')
      await expect(
        members.getByRole('button', { name: 'Remove filter: Role: Owner' })
      ).toBeVisible()
      const chips = await runAxe(page)
      expect(report('filter chips', theme, chips), report('filter chips', theme, chips)).toBe('')

      await members.getByRole('button', { name: 'Columns, Members' }).click()
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitemcheckbox').first()).toBeVisible()
      await afterAnimations(menu)
      const columns = await runAxe(page, '[role="menu"]')
      expect(report('column menu', theme, columns), report('column menu', theme, columns)).toBe('')
    })

    test(`the notification cards on a phone meet WCAG AA contrast in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const result = await contrastOf(
        page,
        '/e2e/harness/?path=/notifications',
        theme,
        'Notifications'
      )
      expect(
        report('notification cards', theme, result),
        report('notification cards', theme, result)
      ).toBe('')
    })
  }
})

/**
 * The ⌘K palette: its dialog surface, the highlighted-option pair, the muted
 * detail text and a disabled row (which axe skips and WCAG exempts), none of
 * which any page above renders.
 */
test.describe('command palette', () => {
  for (const theme of THEMES) {
    test(`the open command palette meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/dashboard&tenants=many')
      await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.keyboard.press('ControlOrMeta+k')
      const palette = page.getByRole('dialog', { name: 'Command palette' })
      await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
      await page.keyboard.type('a')
      // Populated, with one option highlighted and a disabled row listed (axe skips it): an empty palette grades clean and proves nothing.
      await expect(palette.getByRole('option', { name: /^Gamma Ltd/ })).toBeVisible()
      await expect(palette.locator('[data-highlighted]')).toHaveCount(1)

      await afterAnimations(palette)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="dialog"]')
      expect(report('palette', theme, result), report('palette', theme, result)).toBe('')
    })
  }
})

// Each staff surface is asserted present: a page without it grades clean and proves nothing.
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
        '/e2e/harness/?path=/settings/workspace/acme/activity',
        theme,
        { name: 'Activity', level: 2 }
      )
      const row = page.getByRole('row').filter({ hasText: 'Sam Staff' })
      await expect(row.getByText('Staff', { exact: true })).toBeVisible()
      expect(report('staff badge', theme, result), report('staff badge', theme, result)).toBe('')
    })
  }
})

// Each tinted note and error alert is asserted present: a page without it grades clean and proves nothing.
test.describe('notes and errors', () => {
  for (const theme of THEMES) {
    test(`the settings read-only note meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(page, '/e2e/harness/?state=viewer', theme, {
        name: 'Members',
        level: 2,
      })
      await expect(
        page.getByRole('status').filter({ hasText: 'You can view these settings.' })
      ).toBeVisible()
      expect(report('read-only note', theme, result), report('read-only note', theme, result)).toBe(
        ''
      )
    })

    test(`the load error with its retry meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(page, '/e2e/harness/?state=error', theme, {
        name: 'Members',
        level: 2,
      })
      // The members list and the owners read (the last-owner rule's) each show their own error with a retry, and the grade covers both.
      const alerts = page
        .getByRole('alert')
        .filter({ has: page.getByRole('button', { name: 'Try again' }) })
      await expect(alerts).toHaveCount(2)
      await expect(alerts.first()).toBeVisible()
      await expect(alerts.last()).toBeVisible()
      expect(report('load error', theme, result), report('load error', theme, result)).toBe('')
    })
  }
})

// Each maintenance surface is driven by answering the status read, and asserted present before its grade counts.
test.describe('maintenance surfaces', () => {
  for (const theme of THEMES) {
    for (const mode of ['full', 'read_only'] as const) {
      test(`the ${mode} maintenance surface meets WCAG AA contrast in ${theme}`, async ({
        page,
        context,
      }) => {
        await context.route('**/api/v1/status/maintenance', (route) =>
          route.fulfill({
            status: 200,
            headers: { [FALLBACK_HEADER]: '1', 'Maintenance-Mode': mode },
            json: {
              success: true,
              message: 'Maintenance status retrieved.',
              statusCode: 200,
              data: { mode, message: 'Back by 11:00.', since: '2026-10-06T10:42:00.000Z' },
            },
          })
        )
        const result = await contrastOf(
          page,
          '/e2e/harness/?path=/dashboard',
          theme,
          mode === 'full' ? 'We’ll be back soon' : /^Welcome back/
        )
        if (mode === 'read_only') {
          await expect(page.getByRole('region', { name: 'Maintenance' })).toBeVisible()
        }
        await expect(page.getByText('Back by 11:00.')).toBeVisible()
        const name = `maintenance ${mode}`
        expect(report(name, theme, result), report(name, theme, result)).toBe('')
      })
    }
  }
})

/**
 * The toasts, graded at the toast: the popover surface with a status border and
 * icon, which no page entry renders. The error toast comes from an OAuth
 * `?error=` on sign-in, the success toast from resending an invitation on the
 * harness's members page. Nothing in the app raises a warning toast yet.
 */
test.describe('toasts', () => {
  const TOASTS = [
    {
      name: 'error toast',
      url: '/login?error=google_auth_failed',
      title: 'Google sign-in failed. Try again, or sign in with an email link.',
      raise: async () => {},
    },
    {
      name: 'success toast',
      url: '/e2e/harness/',
      title: /^Invitation resent to/,
      raise: async (page: Page) => {
        await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible({
          timeout: COLD_TRANSFORM_BUDGET_MS,
        })
        await page
          .getByRole('button', { name: /^Resend, invitation to/ })
          .first()
          .click()
      },
    },
  ] as const

  for (const theme of THEMES) {
    for (const entry of TOASTS) {
      test(`the ${entry.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
        await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
        await page.goto(entry.url)
        await entry.raise(page)
        const item = page.getByRole('dialog', { name: entry.title })
        await expect(item).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })

        await afterAnimations(item)
        await afterFontsAndFrames(page)
        await page.addScriptTag({ path: AXE_PATH })

        const result = await runAxe(page, '[data-slot="toast"]')
        expect(report(entry.name, theme, result), report(entry.name, theme, result)).toBe('')
      })
    }
  }
})

// Pins the suite's isolation: without the fallback in `../hermetic` this refresh goes through the Vite proxy, `answered` stays empty and teardown reports the unstamped response.
test('a public page gets its bootstrap refresh from the fallback, not the dev server proxy', async ({
  page,
  apiFallback,
}) => {
  await page.goto('/login')
  // The root beforeLoad awaits the refresh, so the heading means it has settled.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  expect(apiFallback.answered).toContain('POST /api/v1/auth/refresh')
})
