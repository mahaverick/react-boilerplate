/**
 * @file The accessibility gate: axe-core run over the whole `document` for every routed page and open dialog, and over the popup alone for menus, through a real `RouterProvider` on a memory history. The pages call `Route.useSearch()`, `useNavigate()` and `useMatches()`, and the app shell holds the landmarks, breadcrumb trail and nav, so a page rendered alone would grade a fragment nobody sees.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axeCore from 'axe-core'
import { http } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { PageSkeleton, type PageVariant } from '@/components/shared/page-skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  INVITATION_ID,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  NOTIFICATION_ID,
  NOTIFICATION_ID_2,
  STAFF_USER_ID,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import {
  fail,
  ok,
  tenantDetail,
  TEST_INVITATION_TOKEN,
  testFlags,
  testOnboarding,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { AuditEntry } from '@/types/api.types'

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: 'https://acme.test',
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const SETTINGS = {
  tenantId: TENANT_ID,
  timezone: 'Europe/London',
  locale: 'en',
  metadata: { tier: 'pro' },
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** `testUser.id` is `USER_ID`, so the first row is always "me". */
const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      tenantId: TENANT.id,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
  {
    membership: {
      id: MEMBERSHIP_ID_2,
      userId: USER_ID_2,
      tenantId: TENANT.id,
      role: 'editor',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D' },
  },
]

const NOTIFICATIONS = [
  {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: 'verify_email',
    title: 'Confirm your email',
    body: 'We sent a link to a@b.com.',
    data: null,
    readAt: null,
    createdAt: '2026-01-02T09:00:00.000Z',
  },
  {
    id: NOTIFICATION_ID_2,
    userId: USER_ID,
    type: 'password_changed',
    title: 'Your password changed',
    body: 'If this was not you, reset it now.',
    data: null,
    readAt: '2026-01-02T10:00:00.000Z',
    createdAt: '2026-01-02T08:00:00.000Z',
  },
]

/** One pending invitation, so the members page's third card has a row to grade. */
const INVITATIONS = [
  {
    id: INVITATION_ID,
    email: 'invitee@b.com',
    role: 'editor',
    invitedBy: { id: USER_ID, firstName: 'A', lastName: 'B' },
    expiresAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-24T00:00:00.000Z',
  },
]
/** One member action and one staff action, so the Staff badge is graded too. */
const AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: AUDIT_ID_2,
    occurredAt: '2026-09-25T10:00:00.000Z',
    action: 'tenant.settings_updated',
    access: 'platform',
    actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
    target: { type: 'settings', id: TENANT_ID },
    metadata: { changed: ['timezone'] },
  },
  {
    id: AUDIT_ID_1,
    occurredAt: '2026-09-25T09:00:00.000Z',
    action: 'tenant.created',
    access: 'member',
    actor: { id: USER_ID, name: 'A B', email: 'a@b.com' },
    target: { type: 'tenant', id: TENANT_ID },
    metadata: { name: 'Acme Corp', slug: 'acme' },
  },
]
const PREFERENCES = [
  { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'password_changed', emailEnabled: true, inAppEnabled: false },
]

/**
 * Answers every fixture an authenticated page can ask for, all populated: the default
 * handlers answer empty, and an empty page gives axe almost no markup to judge.
 */
function mockSignedInData() {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok([{ tenant: TENANT, role: 'owner' }], 'Tenants retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.')),
    http.get('/api/v1/tenants/acme/invitations', () => ok(INVITATIONS, 'Invitations retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
    // The Beta tab and page are graded too, so the flag is on.
    http.get('/api/v1/tenants/acme/flags', () =>
      ok(testFlags({ example_beta_page: true }), 'Flags retrieved.')
    ),
    http.get('/api/v1/tenants/acme/beta', () =>
      ok({ slug: 'acme', enabledAt: '2026-10-05T09:00:00.000Z' }, 'Beta retrieved.')
    ),
    http.get('/api/v1/tenants/acme/audit-log', () =>
      ok({ entries: AUDIT_ENTRIES, nextCursor: 'c2' }, 'Audit log retrieved.')
    ),
    http.get('/api/v1/notifications', () =>
      ok({ notifications: NOTIFICATIONS }, 'Notifications retrieved.')
    ),
    http.get('/api/v1/notifications/preferences', () =>
      ok({ preferences: PREFERENCES }, 'Notification preferences retrieved.')
    )
  )
}

/** Mounts the real route tree at `path`, so the app shell's landmarks are part of what axe grades. */
function renderAppAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/** A signed-in session, already bootstrapped, so `_app`'s guard lets pages render. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** A visitor with no refresh cookie, so `_auth`'s guard lets its pages render. */
function signOut() {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/**
 * jest-axe's default rule set, reproduced because axe-core is driven directly (jest-axe's
 * own `axe()` cannot take `document`: its `mount()` re-serialises anything outside `body`,
 * which destroys the DOM). Every `cat.color` rule is off, as `configureAxe` does, because
 * jsdom has no layout or cascade to compute contrast from (`node_modules/jest-axe/index.js`:
 * "Color contrast checking doesnt work in a jsdom environment"). A green run says nothing
 * about contrast; `e2e/contrast/contrast.test.ts` (`pnpm test:contrast`) measures it in a
 * browser. No other rule is off, `region` included, so if something trips a rule, fix the markup.
 */
const AXE_OPTIONS: axeCore.RunOptions = {
  rules: Object.fromEntries(
    axeCore.getRules(['cat.color']).map(({ ruleId }) => [ruleId, { enabled: false }])
  ),
}

/**
 * The rules axe files under `incomplete` for reasons that belong to jsdom, not to the
 * markup. Pinned as a set so a new one cannot appear unnoticed: `toHaveNoViolations` reads
 * only `violations`, so anything that quietly stops being evaluable would look like a pass.
 *
 * - `page-has-heading-one`, `landmark-one-main`: both set `passForModal`, so axe asks
 *   `isModalOpen()`, which calls `document.elementsFromPoint`. axe polyfills that over
 *   `document.elementFromPoint`, which jsdom does not implement either, so the check throws
 *   and axe files both rules here ("Axe encountered an error"), which `toHaveNoViolations`
 *   does not read, so both would pass vacuously. (With a dialog open, `isModalOpen` returns
 *   before that call and both rules pass.) `expectNoViolations` asserts one `<main>` and one
 *   `<h1>` by hand instead.
 * - `heading-order`: "Unable to determine previous heading" for the first
 *   heading in the tree. Nothing to fix.
 * - `aria-hidden-focus`: "Check that focusable elements are not tabbable in the
 *   current state". Base UI marks the background `aria-hidden` and inert while a
 *   modal is open; whether its contents are still tabbable is a layout question
 *   jsdom cannot answer.
 * - `aria-valid-attr-value`: "Unable to determine if aria-controls referenced ID
 *   exists on the page while using aria-haspopup" (axe's own `controlsWithinPopup`
 *   check). The combobox trigger and its input both carry `aria-controls` alongside
 *   `aria-haspopup`; the "tenant switcher open" test asserts both referenced IDs
 *   resolve. The id is not accepted outright: `isOnlyControlsWithinPopup` still
 *   fails a node whose finding is a genuinely dangling reference (`messageKey: 'noId'`).
 */
const KNOWN_INCOMPLETE = new Set([
  'page-has-heading-one',
  'landmark-one-main',
  'heading-order',
  'aria-hidden-focus',
  'aria-valid-attr-value',
])

/**
 * Whether every check on every node flagged under `aria-valid-attr-value` is
 * `controlsWithinPopup`. axe files the same rule id for a dangling
 * `aria-describedby`/`aria-labelledby` (`messageKey: 'noId'`) or an invalid enumerated value
 * like `aria-current="bogus"`, so accepting the id outright would swallow those too; a node
 * mixing `controlsWithinPopup` with a real dangling reference still fails.
 */
function isOnlyControlsWithinPopup(result: axeCore.IncompleteResult): boolean {
  return result.nodes.every((node) => {
    const keys = [...node.any, ...node.all, ...node.none].map(
      (check) => (check.data as { messageKey?: unknown } | null | undefined)?.messageKey
    )
    return keys.length > 0 && keys.every((key) => key === 'controlsWithinPopup')
  })
}

/**
 * The ids in `results.incomplete` that `KNOWN_INCOMPLETE` does not explain, with
 * `aria-valid-attr-value` narrowed by `isOnlyControlsWithinPopup` rather than accepted by id.
 */
function unexpectedIncomplete(results: axeCore.AxeResults): string[] {
  return results.incomplete
    .filter((result) => {
      if (!KNOWN_INCOMPLETE.has(result.id)) return true
      if (result.id === 'aria-valid-attr-value') return !isOnlyControlsWithinPopup(result)
      return false
    })
    .map((result) => result.id)
}

/**
 * Asserts the whole document is clean, portals, landmarks and page-level rules included,
 * and asserts by hand the two page-level invariants jsdom stops axe from checking (see
 * `KNOWN_INCOMPLETE`).
 *
 * The context must be `document`, not a fragment and not `document.body`: axe's page-level
 * rules (`page-has-heading-one`, `landmark-one-main`, `bypass`, `html-has-lang`,
 * `document-title`) select on `html` and come back `inapplicable` for any smaller context.
 * Measured: with `document.body` every one of them did, so the gate was silently grading a
 * fragment. `html-has-lang`, `document-title` and `bypass` only produce a result when the
 * context is the document, so asserting they ran pins it. That the verdict means anything is
 * pinned by the first test below.
 */
async function expectNoViolations() {
  const results = await axeCore.run(document, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  expect(results.passes.map((result) => result.id)).toEqual(
    expect.arrayContaining(['html-has-lang', 'document-title', 'bypass'])
  )

  expect(unexpectedIncomplete(results)).toEqual([])

  // `page-has-heading-one` and `landmark-one-main`, by hand.
  expect(document.querySelectorAll('main')).toHaveLength(1)
  expect(document.querySelectorAll('h1')).toHaveLength(1)
}

/**
 * `expectNoViolations` for a page whose content is still loading: the same
 * rules, without the one-`h1` check, since a page-shaped skeleton has no
 * heading yet and the shell's `main` is already there.
 */
async function expectNoViolationsWhileLoading() {
  const results = await axeCore.run(document, AXE_OPTIONS)
  expect(results).toHaveNoViolations()
  expect(unexpectedIncomplete(results)).toEqual([])
  expect(document.querySelectorAll('main')).toHaveLength(1)
}

/**
 * Runs the same rule set against one open overlay instead of the document. Base UI portals
 * a menu popup to `document.body`, so at document scope axe's `region` rule would report
 * "Some page content is not contained by landmarks" for every open menu, a page-structure
 * finding that is no barrier in a transient popup focus was just moved into. (The dialog
 * and sheet tests do not hit it because axe exempts `role="dialog"`.) Narrowing the context
 * disables no rule; it leaves the menu's own markup to grade, and the page is still graded
 * at document scope elsewhere.
 *
 * `aria-required-children` only produces a result when axe evaluated a `role="menu"`, so
 * asserting it ran keeps this helper from passing vacuously on the wrong element.
 */
async function expectNoViolationsIn(element: HTMLElement) {
  const results = await axeCore.run(element, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  expect(results.passes.map((result) => result.id)).toContain('aria-required-children')

  expect(unexpectedIncomplete(results)).toEqual([])
}

/**
 * Picks the viewport `useIsMobile` reports. The `matchMedia` stub in `tests/setup.ts`
 * answers a `max-width` query from `window.innerWidth`; every test sets the width before
 * rendering, so no change event is needed.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const realInnerWidth = window.innerWidth

/**
 * Mirrors the shell of `index.html`, which jsdom's blank document lacks. Without a `lang`
 * and a `<title>`, `html-has-lang` and `document-title` fail on every page for a reason that
 * belongs to the harness: index.html ships `<html lang="en">` and `<title>React Boilerplate</title>`.
 * Keep these two in step with that file.
 */
beforeAll(() => {
  document.documentElement.lang = 'en'
  document.title = 'React Boilerplate'
})

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useSidebarStore.setState({ isCollapsed: false })
  useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
})

afterEach(() => {
  setViewportWidth(realInnerWidth)
})

describe('the axe gate itself', () => {
  /**
   * A stray `<p>` outside every landmark is what `region` is about. If this stops
   * reporting it, the rule set is no longer running and every other test here is vacuous.
   * It asserts the rule that fired, not merely that something failed.
   */
  it('reports a violation when there is one, so a green run means something', async () => {
    signOut()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const stray = document.createElement('p')
    stray.textContent = 'Not in any landmark.'
    document.body.append(stray)
    try {
      const results = await axeCore.run(document, AXE_OPTIONS)
      expect(results.violations.map((violation) => violation.id)).toContain('region')
      expect(results).not.toHaveNoViolations()
    } finally {
      stray.remove()
    }
  })

  /**
   * The same proof for `unexpectedIncomplete`: `aria-valid-attr-value` is accepted only for
   * `controlsWithinPopup`, so a dangling reference (the `noId` messageKey) must still come
   * back as unexpected. If it stops, a broken `aria-describedby` on any combobox could go unnoticed.
   */
  it('does not swallow a dangling aria-describedby under aria-valid-attr-value', async () => {
    const stray = document.createElement('button')
    stray.setAttribute('aria-describedby', 'does-not-exist')
    stray.textContent = 'Stray'
    document.body.append(stray)
    try {
      const results = await axeCore.run(document, {
        runOnly: { type: 'rule', values: ['aria-valid-attr-value'] },
      })
      expect(unexpectedIncomplete(results)).toContain('aria-valid-attr-value')
    } finally {
      stray.remove()
    }
  })
})

/** Each routed page in its settled state, not its skeleton: every entry waits on something only the loaded page renders. */
describe('signed-out pages', () => {
  beforeEach(signOut)

  it.each([
    ['login', '/login', () => screen.findByRole('button', { name: 'Sign in' })],
    ['register', '/register', () => screen.findByRole('button', { name: 'Create account' })],
    [
      'forgot-password',
      '/forgot-password',
      () => screen.findByRole('button', { name: 'Send reset link' }),
    ],
    [
      'reset-password',
      '/reset-password?token=a-token',
      () => screen.findByRole('button', { name: 'Reset password' }),
    ],
    [
      'verify-email',
      '/verify-email?token=a-token',
      () => screen.findByRole('button', { name: 'Verify email' }),
    ],
    [
      'register, prefilled from an invitation',
      '/register?email=a%40b.com',
      () => screen.findByDisplayValue('a@b.com'),
    ],
    [
      'invitation accept',
      `/invitations/accept?token=${TEST_INVITATION_TOKEN}`,
      () => screen.findByRole('link', { name: 'Log in' }),
    ],
    [
      'invitation accept without a token',
      '/invitations/accept',
      () => screen.findByRole('heading', { name: 'This link is incomplete' }),
    ],
  ])('%s has no axe violations', async (_name, path, ready) => {
    renderAppAt(path)
    await ready()
    await expectNoViolations()
  })

  /**
   * The toast region is portalled to `document.body`, outside every other landmark, so it is
   * graded at document scope. While the stack is collapsed, Base UI renders the close button
   * `aria-hidden` yet tabbable; axe's `aria-hidden-focus` lands in `incomplete` under jsdom
   * (`KNOWN_INCOMPLETE`), so this gate does not clear that state. It is accepted upstream
   * behaviour: Tab reaches the toast first, which expands the stack and un-hides the button.
   */
  it('login with an OAuth error toast open has no axe violations', async () => {
    const user = userEvent.setup()
    renderAppAt('/login?error=google_auth_failed')
    const region = await screen.findByRole('region', { name: 'Status messages' })
    const item = await within(region).findByRole('dialog', {
      name: 'Google sign-in failed. Please try again.',
    })
    await expectNoViolations()

    await user.hover(item)
    await within(item).findByRole('button', { name: 'Close toast' })
    await expectNoViolations()
  })
})

describe('signed-in pages', () => {
  beforeEach(() => {
    signIn()
    mockSignedInData()
  })

  it.each([
    ['dashboard', '/dashboard', () => screen.findByRole('heading', { name: /Welcome back/ })],
    ['settings', '/settings', () => screen.findByRole('region', { name: 'Workspace' })],
    [
      'profile',
      '/settings/account/profile',
      () => screen.findByRole('button', { name: 'Save changes' }),
    ],
    [
      'security',
      '/settings/account/security',
      () => screen.findByRole('button', { name: 'Change password' }),
    ],
    [
      'notification settings',
      '/settings/account/notifications',
      () => screen.findAllByRole('switch'),
    ],
    [
      'notifications',
      '/notifications',
      () => screen.findByRole('heading', { name: 'Notifications', level: 1 }),
    ],
    ['tenants', '/tenants', () => screen.findByRole('link', { name: /Acme Corp/ })],
    [
      'tenant overview',
      '/tenants/acme',
      // The Getting started card loads after the page; wait for it, since the checklist is the surface worth grading.
      async () => {
        await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
        return screen.findByRole('button', { name: 'Mark done: Read the getting started guide' })
      },
    ],
    [
      'workspace members',
      '/settings/workspace/acme/members',
      // Both lists: the member table and the pending invitations under it.
      async () => {
        await screen.findByRole('table')
        return screen.findByText('invitee@b.com')
      },
    ],
    [
      'workspace general',
      '/settings/workspace/acme/general',
      () => screen.findByRole('button', { name: 'Save settings' }),
    ],
    [
      'tenant beta',
      '/tenants/acme/beta',
      () => screen.findByText('Beta features are on for acme.'),
    ],
    [
      'workspace activity',
      '/settings/workspace/acme/activity',
      () => screen.findByText('changed the settings (timezone)'),
    ],
    [
      'invitation accept',
      `/invitations/accept?token=${TEST_INVITATION_TOKEN}`,
      () => screen.findByRole('button', { name: 'Accept invitation' }),
    ],
  ])('%s has no axe violations', async (_name, path, ready) => {
    renderAppAt(path)
    await ready()
    await expectNoViolations()
  })

  it('the settings nav with no tenant to act on has no axe violations', async () => {
    // No eligible tenant, so the URL names none and the Workspace items render disabled and described by the hint.
    localStorage.clear()
    useCurrentTenantStore.setState({ remembered: {} })
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }], 'Tenants.')
      )
    )
    renderAppAt('/settings/account/profile')
    await screen.findByRole('button', { name: 'Save changes' })
    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('button', { name: 'Members' })).toHaveAccessibleDescription(
      'Choose a tenant first.'
    )
    await expectNoViolations()
  })

  it.each([
    ['missing', [], 'Tenant not available'],
    [
      'suspended',
      [{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }],
      'Tenant suspended',
    ],
  ])(
    'a workspace settings page for a %s tenant has one h1 and no axe violations',
    async (_name, list, panel) => {
      server.use(
        http.get('/api/v1/tenants', () => ok(list, 'Tenants.')),
        http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
      )
      renderAppAt('/settings/workspace/acme/members')
      // The settings layout's h1 names the section; the gate's panel sits under it.
      await screen.findByRole('heading', { name: panel, level: 2 })
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Members')
      await expectNoViolations()
    }
  )

  it('tenants list with a suspended row has no axe violations', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }], 'Tenants.')
      )
    )
    renderAppAt('/tenants')
    await screen.findByText('Suspended')
    await expectNoViolations()
  })

  it('suspended tenant page has no axe violations', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }], 'Tenants.')
      ),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Tenant suspended', level: 1 })
    await expectNoViolations()
  })

  it('tenant overview under platform access has no axe violations', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'viewer', 'platform'), 'Tenant retrieved.')
      )
    )
    renderAppAt('/tenants/acme')
    await screen.findByText(/as platform staff/)
    await screen.findByRole('heading', { name: 'Getting started', level: 2 })
    await expectNoViolations()
  })

  it.each([
    [
      'dismissed, as its owner',
      testOnboarding({ state: 'dismissed', dismissedAt: '2026-10-01T09:00:00.000Z' }),
      () => screen.findByRole('button', { name: 'Show getting started' }),
    ],
    [
      'just completed',
      testOnboarding(
        { state: 'complete', completedAt: new Date(Date.now() - 60_000).toISOString() },
        ['configure_settings', 'invite_teammate']
      ),
      () => screen.findByRole('heading', { name: 'You’re all set', level: 2 }),
    ],
  ])(
    'tenant overview with getting started %s has no axe violations',
    async (_name, onboarding, ready) => {
      server.use(
        http.get('/api/v1/tenants/acme/onboarding', () => ok(onboarding, 'Onboarding retrieved.'))
      )
      renderAppAt('/tenants/acme')
      await ready()
      await expectNoViolations()
    }
  )

  describe('loading states', () => {
    it.each([
      ['the dashboard template while the tenant list loads', '/dashboard', '/api/v1/tenants'],
      ['the detail template while the tenant loads', '/tenants/acme', '/api/v1/tenants/acme'],
    ])('%s has no axe violations', async (_name, path, held) => {
      server.use(http.get(held, () => new Promise<Response>(() => {})))
      renderAppAt(path)
      await screen.findByRole('status', { name: 'Loading' })
      await expectNoViolationsWhileLoading()
    })
  })
})

/** Makes the status endpoint answer `mode` with the owner's message. */
function serveMaintenance(mode: 'read_only' | 'full') {
  server.use(
    http.get('/api/v1/status/maintenance', () =>
      ok(
        { mode, message: 'Upgrading the database. Back by 11:00.', since: '2026-10-06T10:42:00Z' },
        'Maintenance status retrieved.'
      )
    )
  )
}

describe('maintenance mode', () => {
  it('the full maintenance page, signed in, has no axe violations', async () => {
    signIn()
    mockSignedInData()
    serveMaintenance('full')
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: 'We’ll be back soon' })
    await expectNoViolations()
  })

  it('the full maintenance page over sign-in has no axe violations', async () => {
    signOut()
    serveMaintenance('full')
    renderAppAt('/login')
    await screen.findByText('Upgrading the database. Back by 11:00.')
    await expectNoViolations()
  })

  it('a page under the read-only banner has no axe violations', async () => {
    signIn()
    mockSignedInData()
    serveMaintenance('read_only')
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    await screen.findByRole('region', { name: 'Maintenance' })
    await expectNoViolations()
  })

  it('sign-in under the read-only banner has no axe violations', async () => {
    signOut()
    serveMaintenance('read_only')
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })
    await screen.findByRole('region', { name: 'Maintenance' })
    await expectNoViolations()
  })
})

/** The accept page's other states, each its own render: the default sweep only sees the invited account on a valid link. */
describe('invitation accept states', () => {
  const acceptPath = `/invitations/accept?token=${TEST_INVITATION_TOKEN}`

  beforeEach(() => {
    signIn()
    mockSignedInData()
  })

  it('has no violations signed in as the wrong account', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        ok(
          {
            tenant: { name: 'Acme Corp', slug: 'acme' },
            role: 'editor',
            invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
            email: 'someone@else.com',
          },
          'Invitation retrieved.'
        )
      )
    )
    renderAppAt(acceptPath)
    await screen.findByRole('button', { name: 'Sign out' })
    await expectNoViolations()
  })

  it('has no violations for an invalid invitation', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
      )
    )
    renderAppAt(acceptPath)
    await screen.findByRole('heading', { name: 'This invitation can’t be used' })
    await expectNoViolations()
  })

  it('has no violations when the preview request failed', async () => {
    server.use(http.post('/api/v1/invitations/preview', () => fail('Something went wrong.', 500)))
    renderAppAt(acceptPath)
    // The preview query retries a non-404 once, so the alert appears after that retry.
    await screen.findByRole('alert')
    await expectNoViolations()
  })

  it('has no violations with the unverified-email refusal showing', async () => {
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        fail(
          'Verify your email address before accepting this invitation.',
          403,
          'invitation_email_unverified'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(acceptPath)
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    await screen.findByRole('alert')
    await expectNoViolations()
  })
})

/**
 * Overlays and menus, which a default-state sweep never sees. A Base UI `Dialog` with no
 * `Title` gets `aria-labelledby: null` and, unlike Radix, emits no development warning, so
 * the failure shows only when axe looks at the dialog while it is open.
 */
describe('open overlays', () => {
  beforeEach(() => {
    signIn()
    mockSignedInData()
  })

  it('has no violations with the remove-member dialog open, and the dialog is named', async () => {
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    // Cleo is an editor, so her row's Remove control is enabled and opens the dialog.
    const row = (await screen.findByRole('cell', { name: /Cleo/ })).closest('tr')
    expect(row).not.toBeNull()
    await user.click(await within(row as HTMLElement).findByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('alertdialog')
    // Asserted directly rather than implied by a clean axe run: this catches a dropped Title.
    expect(dialog).toHaveAccessibleName('Remove Cleo D?')
    await expectNoViolations()
  })

  it('has no violations with the revoke-invitation dialog open, and the dialog is named', async () => {
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the invitation to invitee@b.com?')
    await expectNoViolations()
  })

  it('has no violations with the dismiss-getting-started dialog open, and the dialog is named', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Dismiss getting started?')
    await expectNoViolations()
  })

  it('has no violations on the members page as staff through platform access', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner', 'platform'), 'Tenant retrieved.')
      )
    )
    renderAppAt('/settings/workspace/acme/members')
    await screen.findByRole('table')
    await screen.findByText('invitee@b.com')

    expect(
      screen.getByText('You’re viewing this tenant as staff. Make changes from the staff console.')
    ).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the member list stacked as cards on a phone', async () => {
    // The card layout is a second render path the table tests never touch, so it can hide a duplicate id or an unlabelled control.
    setViewportWidth(390)
    renderAppAt('/settings/workspace/acme/members')
    await screen.findByText('Cleo D')
    await screen.findByText('invitee@b.com')

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the mobile sidebar sheet open, and the sheet is named', async () => {
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAccessibleName('Sidebar')
    await expectNoViolations()
  })

  /**
   * Opens every menu that exists. `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and
   * throws outside a `Menu.Group`, so a wrong composition replaces the whole app with the
   * root error boundary, and only once a menu is opened. The test then fails at `findByRole`.
   */
  it.each([
    ['the notification bell', /^Notifications,/],
    ['the user menu', /^Account menu for/],
  ])('has no violations with %s menu open', async (_label, name) => {
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name }))

    // Finding the menu is the check: axe over a menu that never opened grades nothing.
    const menu = await screen.findByRole('menu')
    // A menu that opened empty would pass axe without grading any items.
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })

  /**
   * The switcher is a combobox whose popup is a `dialog` holding the search box and a
   * `listbox`. axe exempts `role="dialog"` from `region`, as for the sheet, so this one is
   * graded at document scope.
   */
  it('has no violations with the tenant switcher open, and its listbox is populated', async () => {
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    const trigger = screen.getByRole('combobox', { name: /^Switch tenant/ })
    await user.click(trigger)

    const popup = await screen.findByRole('dialog', { name: 'Switch tenant' })
    const listbox = within(popup).getByRole('listbox')
    expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0)

    // Both `aria-controls` name a real element, so their `aria-valid-attr-value` finding (see `KNOWN_INCOMPLETE`) is axe declining to resolve a reference, not a broken one.
    const input = screen.getByLabelText('Search tenants')
    for (const element of [trigger, input]) {
      const controls = element.getAttribute('aria-controls')
      expect(controls).not.toBeNull()
      expect(document.getElementById(controls as string)).not.toBeNull()
    }

    await expectNoViolations()
  })

  it('has no violations with the staff user menu open', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'admin' } })
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: /^Account menu for/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Platform' })).toBeInTheDocument()
    await expectNoViolationsIn(menu)
  })

  it('has no violations with the theme menu open from the header on a phone', async () => {
    // The ThemeToggle sits in the header, outside the sheet, so on a phone it is opened without the drawer.
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: /Change theme/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })

  it('has no violations with the account menu open inside the mobile sheet', async () => {
    // Below `md` the sidebar, and the account menu in its footer, renders inside the sheet, so the menu is opened from there.
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    await screen.findByRole('dialog')
    await user.click(await screen.findByRole('button', { name: /^Account menu for/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })
})

/** What axe cannot see: whether a focusable thing shows focus. With no layout or cascade, a removed outline with nothing in its place is invisible to it, so this asserts the class. */
describe('focus indicators', () => {
  /**
   * No route mounts `Tabs`: `$slug.tsx` uses a nav of real links because its tabs are
   * routes. The primitive is still part of the approved set, so it is rendered directly here.
   *
   * Base UI renders `Tabs.Panel` with `tabIndex: open ? 0 : -1`
   * (@base-ui/react@1.8.0, tabs/panel/TabsPanel.js:76), so an open panel is reachable by
   * keyboard, and suppressing its outline with nothing in its place fails WCAG 2.4.7.
   */
  it('gives the tab panel a visible focus ring, because Base UI makes it tabbable', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel body</TabsContent>
      </Tabs>
    )

    const panel = screen.getByRole('tabpanel')

    expect(panel).toHaveAttribute('tabindex', '0')
    expect(panel.className).toMatch(/focus-visible:/)
  })
})

/** What axe cannot see: the order focus moves in, and where it lands when an overlay closes. */
describe('keyboard', () => {
  it('tabs through the login form in the order the page reads', async () => {
    signOut()
    const user = userEvent.setup()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const expected = [
      // Every layout's first Tab stop.
      screen.getByRole('link', { name: 'Skip to content' }),
      screen.getByLabelText('Email'),
      // The login-04 layout puts the reset link in the password label's row, so it reads, and tabs, before the field.
      screen.getByRole('link', { name: 'Forgot password?' }),
      screen.getByLabelText('Password'),
      screen.getByRole('button', { name: 'Sign in' }),
      // A plain anchor to a same-origin API route, not a button with a click handler, so it is in the tab order without extra code.
      screen.getByRole('link', { name: 'Continue with Google' }),
      screen.getByRole('link', { name: 'Create an account' }),
    ]
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      GOOGLE_OAUTH_PATH
    )

    for (const element of expected) {
      await user.tab()
      expect(document.activeElement).toBe(element)
    }
  })

  it('returns focus to the theme trigger when the menu is closed with Escape', async () => {
    useThemeStore.setState({ theme: 'system' })
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: 'Theme: system. Change theme' })
    // Opened from the keyboard because the focus restoration this checks only matters to a keyboard user.
    await user.tab()
    expect(document.activeElement).toBe(trigger)
    await user.keyboard('{Enter}')
    await screen.findByRole('menuitem', { name: 'Dark' })

    await user.keyboard('{Escape}')

    // Base UI restores focus after the popup unmounts, so wait for it.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })
})

describe('page skeletons', () => {
  it.each<PageVariant>(['list', 'detail', 'dashboard', 'settings'])(
    'the %s template has no axe violations inside a page',
    async (variant) => {
      render(
        <main>
          <h1>Page</h1>
          <PageSkeleton variant={variant} />
        </main>
      )
      await expectNoViolationsWhileLoading()
    }
  )
})
