import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axeCore from 'axe-core'
import { http } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import { fail, ok, tenantDetail, TEST_INVITATION_TOKEN, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { AuditEntry, PlatformAuditEntry } from '@/types/api.types'

/**
 * THE ACCESSIBILITY GATE. Spec section 9's criteria, made enforceable.
 *
 * Five things about this file are deliberate and easy to undo by accident:
 *
 * 1. IT RUNS OVER `document`, NOT over a fragment. Not `axe(container)` and not
 *    even `axe(document.body)`: axe's PAGE-LEVEL rules — `page-has-heading-one`,
 *    `landmark-one-main`, `bypass`, `html-has-lang`, `document-title` — select on
 *    `html`, and axe reports them as `inapplicable` whenever the context is
 *    anything smaller than the document. Measured: with `document.body` as the
 *    context every one of them came back inapplicable, so the gate was silently
 *    grading a fragment. jest-axe's own `axe()` CANNOT take `document` (its
 *    `mount()` re-serialises anything not inside `body`, which destroys the
 *    DOM), so axe-core is called directly and jest-axe's default rule set is
 *    reproduced explicitly below. `toHaveNoViolations` is still jest-axe's.
 *
 * 2. WHAT COLOUR CONTRAST IS NOT CHECKED HERE. Every `cat.color` rule is
 *    disabled — by us here, exactly as jest-axe does it by default, because
 *    contrast cannot be computed in jsdom, which has no layout and no cascade
 *    (`node_modules/jest-axe/index.js`: "Color contrast checking doesnt work in
 *    a jsdom environment"). A green run on this file therefore says NOTHING
 *    about contrast. That is a browser check, and automating it belongs to the
 *    Phase B Playwright gate.
 *
 * 3. TWO PAGE-LEVEL RULES CANNOT RUN UNDER JSDOM, SO THEY ARE ASSERTED BY HAND.
 *    `page-has-heading-one` and `landmark-one-main` both query
 *    `[role=heading][aria-level=1]`, and jsdom's selector engine REJECTS an
 *    unquoted attribute value that starts with a digit — `document.querySelectorAll`
 *    throws "Invalid selector" on it. axe catches that and files the rule under
 *    `incomplete`, which `toHaveNoViolations` does not read, so both rules pass
 *    vacuously. `expectNoViolations` therefore asserts exactly one `<main>` and
 *    exactly one `<h1>` itself. That is what caught the five auth pages having
 *    no level-one heading at all.
 *
 * 4. NO RULE IS TURNED OFF beyond contrast. jest-axe's defaults are used as they
 *    come, `region` included. An earlier round claimed `region` would flag the
 *    sidebar's header and footer; measured, it does not — everything in there
 *    sits inside a `button` or an `a` — and the rule genuinely runs (a stray
 *    `<p>` appended to `document.body` IS flagged, which the first test below
 *    asserts). If something starts tripping a rule, fix the markup.
 *
 * 5. THE DOCUMENT SHELL IS MIRRORED FROM `index.html`. jsdom's blank document
 *    has no `lang` and no `<title>`, so `html-has-lang` and `document-title`
 *    failed on every page for a reason belonging to the test harness rather than
 *    to the app — index.html really does ship both. Supplying them is providing
 *    the real shell, not suppressing a finding.
 *
 * Driven through a real `RouterProvider` on a memory history, not by rendering
 * each page component standalone as the brief sketched: the pages call
 * `Route.useSearch()`, `useNavigate()` and `useMatches()`, and the app shell is
 * where the landmarks, the breadcrumb trail and the nav actually live. Rendering
 * a page without it would gate a fragment nobody ever sees.
 */
const TENANT = {
  id: 't1',
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
  tenantId: 't1',
  timezone: 'Europe/London',
  locale: 'en',
  metadata: { tier: 'pro' },
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** `testUser` is `u1`, so the first row is always "me". */
const MEMBERS = [
  {
    membership: {
      id: 'm-u1',
      userId: 'u1',
      tenantId: TENANT.id,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
  {
    membership: {
      id: 'm-u2',
      userId: 'u2',
      tenantId: TENANT.id,
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: 'u2', email: 'c@d.com', firstName: 'Cleo', lastName: 'D' },
  },
]

const NOTIFICATIONS = [
  {
    id: 'n1',
    userId: 'u1',
    type: 'verify_email',
    title: 'Confirm your email',
    body: 'We sent a link to a@b.com.',
    data: null,
    readAt: null,
    createdAt: '2026-01-02T09:00:00.000Z',
  },
  {
    id: 'n2',
    userId: 'u1',
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
    id: 'inv-1',
    email: 'invitee@b.com',
    role: 'editor',
    invitedBy: { id: 'u1', firstName: 'A', lastName: 'B' },
    expiresAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-24T00:00:00.000Z',
  },
]
/** One member action and one staff action, so the Staff badge is graded too. */
const AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: 'a2',
    occurredAt: '2026-09-25T10:00:00.000Z',
    action: 'tenant.settings_updated',
    access: 'platform',
    actor: { id: 's1', name: 'Sam Staff', email: 'sam@platform.test' },
    target: { type: 'settings', id: 't1' },
    metadata: { changed: ['timezone'] },
  },
  {
    id: 'a1',
    occurredAt: '2026-09-25T09:00:00.000Z',
    action: 'tenant.created',
    access: 'member',
    actor: { id: 'u1', name: 'A B', email: 'a@b.com' },
    target: { type: 'tenant', id: 't1' },
    metadata: { name: 'Acme Corp', slug: 'acme' },
  },
]
const PREFERENCES = [
  { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'password_changed', emailEnabled: true, inAppEnabled: false },
]

/**
 * Every fixture an authenticated page can ask for, all populated.
 *
 * Populated on purpose: the default handlers answer empty, and an empty page
 * is the one state where axe has almost no markup to judge. The rows, the
 * member table and the role selects are the interesting surface.
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

function renderAppAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
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
 * jest-axe's default rule set, reproduced explicitly because axe-core is being
 * driven directly. This is exactly what `configureAxe` does on import: take
 * every rule tagged `cat.color` and switch it off, since jsdom cannot compute
 * contrast.
 */
const AXE_OPTIONS: axeCore.RunOptions = {
  rules: Object.fromEntries(
    axeCore.getRules(['cat.color']).map(({ ruleId }) => [ruleId, { enabled: false }])
  ),
}

/**
 * The rules axe files under `incomplete` here for reasons that belong to jsdom,
 * not to the markup. Pinned as a set so a NEW one cannot appear unnoticed —
 * `toHaveNoViolations` reads only `violations`, so anything that quietly stops
 * being evaluable would otherwise look like a pass.
 *
 * - `page-has-heading-one`, `landmark-one-main`: axe's selector contains
 *   `[aria-level=1]`, which jsdom rejects as an invalid selector. Asserted by
 *   hand below instead.
 * - `heading-order`: "Unable to determine previous heading" for the first
 *   heading in the tree. Nothing to fix.
 * - `aria-hidden-focus`: "Check that focusable elements are not tabbable in the
 *   current state". Base UI marks the background `aria-hidden` and inert while a
 *   modal is open; whether its contents are still tabbable is a layout question
 *   jsdom cannot answer.
 * - `aria-valid-attr-value`: "Unable to determine if aria-controls referenced ID
 *   exists on the page while using aria-haspopup" (axe's own `controlsWithinPopup`
 *   check). The combobox trigger and its input both carry `aria-controls`
 *   alongside `aria-haspopup`, and both referenced IDs resolving is asserted
 *   in code by the "tenant switcher open" test below, not just claimed here.
 *   This id is NOT accepted outright: `isOnlyControlsWithinPopup`, below,
 *   still fails a node whose `aria-valid-attr-value` finding is a genuinely
 *   dangling reference (`messageKey: 'noId'`) rather than this one.
 */
const KNOWN_INCOMPLETE = new Set([
  'page-has-heading-one',
  'landmark-one-main',
  'heading-order',
  'aria-hidden-focus',
  'aria-valid-attr-value',
])

/**
 * `aria-valid-attr-value` is pinned above for exactly ONE reason
 * (`controlsWithinPopup`), but axe files the SAME rule id for a genuinely
 * dangling `aria-describedby`/`aria-labelledby` (`messageKey: 'noId'`) or an
 * invalid enumerated value like `aria-current="bogus"`. Accepting the id
 * outright would swallow those too, so this checks every `any`/`all`/`none`
 * check on every flagged node and accepts the result only when EVERY one of
 * them is `controlsWithinPopup` — a node mixing that with a real dangling
 * reference still fails.
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
 * `results.incomplete`, minus the ones `KNOWN_INCOMPLETE` explains — with
 * `aria-valid-attr-value` narrowed by `isOnlyControlsWithinPopup` rather than
 * accepted by id alone, so a real dangling ARIA reference still surfaces here.
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
 * Asserts the WHOLE document is clean — portals, landmarks and page-level rules
 * included — and then asserts by hand the two page-level invariants jsdom stops
 * axe from checking (see note 3 in the file header).
 *
 * That the axe verdict means anything is itself asserted, by the first test
 * below: a rule set that silently stopped running would make every page here
 * "pass".
 */
async function expectNoViolations() {
  const results = await axeCore.run(document, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  // THE CONTEXT ITSELF, PINNED. Changing `document` above to `document.body` —
  // the exact regression note 1 describes — makes every page-level rule
  // inapplicable while leaving `region`, the hand assertions below and all 17
  // tests passing. It was measured: someone made that one-word edit and the
  // suite stayed green, which is how a false green comes back. These three
  // rules only produce a result when the context IS the document, so asserting
  // they RAN is what makes the context non-negotiable rather than a comment
  // somebody trusts.
  expect(results.passes.map((result) => result.id)).toEqual(
    expect.arrayContaining(['html-has-lang', 'document-title', 'bypass'])
  )

  expect(unexpectedIncomplete(results)).toEqual([])

  // `page-has-heading-one` and `landmark-one-main`, by hand.
  expect(document.querySelectorAll('main')).toHaveLength(1)
  expect(document.querySelectorAll('h1')).toHaveLength(1)
}

/**
 * The same rule set, run against ONE OPEN OVERLAY instead of the document.
 *
 * Why this exists rather than reusing `expectNoViolations` for menus: Base UI
 * portals a menu popup to `document.body`, so at document scope axe's `region`
 * rule reports "Some page content is not contained by landmarks" for every open
 * menu. That is a PAGE-STRUCTURE rule - landmarks are how a screen-reader user
 * navigates the standing regions of a page - and it does not describe a barrier
 * in a transient popup that focus has just been moved into. The dialog and
 * sheet tests above do not hit it only because axe exempts `role="dialog"`.
 *
 * No rule is disabled here. The rule set is identical; the CONTEXT is narrowed,
 * so page-structure rules simply have no page to judge and the menu's own
 * markup - `menuitem` roles, accessible names, aria-* wiring - is what gets
 * graded. The page itself is still graded at document scope by the tests above.
 *
 * The crash class this block exists for is caught before axe runs at all: a
 * `DropdownMenuLabel` outside a `Menu.Group` throws on open, so `findByRole`
 * never resolves and the test fails there.
 */
async function expectNoViolationsIn(element: HTMLElement) {
  const results = await axeCore.run(element, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  // THE CONTEXT ITSELF, PINNED, the same way `expectNoViolations` pins the
  // document. `aria-required-children` is the rule that asks whether a
  // `role="menu"` actually contains menu items, so it only produces a result
  // when axe really evaluated a menu. Asserting it RAN is what stops this
  // helper from passing vacuously if someone narrows the context further or
  // hands it an element that is not the popup.
  expect(results.passes.map((result) => result.id)).toContain('aria-required-children')

  expect(unexpectedIncomplete(results)).toEqual([])
}

/**
 * Picks the viewport `useIsMobile` reports.
 *
 * It reads `window.innerWidth` for the VALUE and only uses `matchMedia` for the
 * listener, so the width is what decides — but `tests/setup.ts`'s stub answers
 * every query with `matches: false`, which is fine here because nothing in this
 * file changes width while mounted.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const realInnerWidth = window.innerWidth

/**
 * The bits of `index.html` that jsdom's blank document does not have. Without
 * them `html-has-lang` and `document-title` fail on every page for a reason
 * that belongs to the harness, not the app — index.html really does ship
 * `<html lang="en">` and `<title>React Boilerplate</title>`. Keep these two in
 * step with that file.
 */
beforeAll(() => {
  document.documentElement.lang = 'en'
  document.title = 'React Boilerplate'
})

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useSidebarStore.setState({ isCollapsed: false })
})

afterEach(() => {
  setViewportWidth(realInnerWidth)
})

describe('the axe gate itself', () => {
  it('reports a violation when there is one, so a green run means something', async () => {
    signOut()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    // Outside every landmark, which is exactly what `region` is about. If
    // this ever stops failing, the rule set below is no longer running and
    // every other test in this file is vacuous.
    const stray = document.createElement('p')
    stray.textContent = 'Not in any landmark.'
    document.body.append(stray)
    try {
      const results = await axeCore.run(document, AXE_OPTIONS)
      // The RULE, not merely "something failed": a planted violation only
      // proves the gate if the rule it was planted for is the one that fired.
      expect(results.violations.map((violation) => violation.id)).toContain('region')
      expect(results).not.toHaveNoViolations()
    } finally {
      stray.remove()
    }
  })

  // Same proof as above, for the narrower claim `unexpectedIncomplete` makes:
  // `aria-valid-attr-value` is accepted ONLY for `controlsWithinPopup`, so a
  // genuinely dangling reference — the `noId` messageKey, not that one — must
  // still come back as unexpected. If this ever stops failing, the narrowing
  // has widened back to accepting the whole rule id and every combobox on
  // every page could grow a broken `aria-describedby` unnoticed.
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

/**
 * Each routed page in its settled state — not its skeleton. Every entry waits
 * on something only the loaded page renders before axe is asked anything.
 */
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
})

describe('signed-in pages', () => {
  beforeEach(() => {
    signIn()
    mockSignedInData()
  })

  it.each([
    ['dashboard', '/dashboard', () => screen.findByRole('heading', { name: /Welcome back/ })],
    ['profile', '/profile', () => screen.findByRole('heading', { name: 'Profile' })],
    [
      'notifications',
      '/notifications',
      () => screen.findByRole('heading', { name: 'Notifications', level: 1 }),
    ],
    ['tenants', '/tenants', () => screen.findByRole('link', { name: /Acme Corp/ })],
    [
      'tenant overview',
      '/tenants/acme',
      () => screen.findByRole('heading', { name: 'Acme Corp', level: 1 }),
    ],
    [
      'tenant members',
      '/tenants/acme/members',
      // Both lists: the member table and the pending invitations under it.
      async () => {
        await screen.findByRole('table')
        return screen.findByText('invitee@b.com')
      },
    ],
    [
      'tenant settings',
      '/tenants/acme/settings',
      () => screen.findByRole('button', { name: 'Save settings' }),
    ],
    [
      'tenant activity',
      '/tenants/acme/activity',
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

  it('tenant overview under platform access has no axe violations', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'viewer', 'platform'), 'Tenant retrieved.')
      )
    )
    renderAppAt('/tenants/acme')
    await screen.findByText(/as platform staff/)
    await expectNoViolations()
  })

  it('platform activity has no axe violations', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'admin' } })
    const entries: PlatformAuditEntry[] = AUDIT_ENTRIES.map((entry) => ({
      ...entry,
      tenant: { id: 't1', name: 'Acme Corp', slug: 'acme' },
    }))
    server.use(
      http.get('/api/v1/platform/audit-log', () =>
        ok({ entries, nextCursor: null }, 'Audit log retrieved.')
      ),
      http.get('/api/v1/tenants/platform/members', () => ok(MEMBERS, 'Members retrieved.'))
    )
    renderAppAt('/platform/activity')
    await screen.findByText('changed the settings (timezone)')
    await expectNoViolations()
  })
})

/**
 * The accept page's other states, each one its own render: a default sweep
 * only ever sees the invited account arriving at a valid link.
 */
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
    // The preview retries a non-404 once, so the failure takes a moment.
    await screen.findByRole('alert', {}, { timeout: 5000 })
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
 * The two states a default-state sweep can never see.
 *
 * A Base UI `Dialog` with no `Title` gets `aria-labelledby: null` and — unlike
 * Radix — emits NO development warning about it. The failure is invisible until
 * axe looks at the dialog while it is OPEN, which is why these drive one open
 * rather than trusting the closed markup.
 */
describe('open overlays', () => {
  beforeEach(() => {
    signIn()
    mockSignedInData()
  })

  it('has no violations with the remove-member dialog open, and the dialog is named', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    // Cleo is a plain member and not the last owner, so her row's control is
    // the enabled one that opens the dialog.
    const row = (await screen.findByRole('cell', { name: /Cleo/ })).closest('tr')
    expect(row).not.toBeNull()
    await user.click(await within(row as HTMLElement).findByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('alertdialog')
    // The named-dialog claim stated directly, not merely implied by a clean
    // axe run: this is the assertion that catches a Title being dropped.
    expect(dialog).toHaveAccessibleName('Remove Cleo D?')
    await expectNoViolations()
  })

  it('has no violations with the revoke-invitation dialog open, and the dialog is named', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the invitation to invitee@b.com?')
    await expectNoViolations()
  })

  it('has no violations with the member list stacked as cards on a phone', async () => {
    // A second render path is a second chance to ship a duplicate id or an
    // unlabelled control, and it is the path the table tests never touch.
    setViewportWidth(390)
    renderAppAt('/tenants/acme/members')
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
   * OPENED MENUS. Before these, the overlay block covered a dialog and a sheet
   * and no open menu at all - and a page-crashing bug lived in exactly that
   * blind spot through 234 passing tests: `DropdownMenuLabel` is Base UI's
   * `Menu.GroupLabel` and throws outside a `Menu.Group`, so opening the bell
   * replaced the whole app with the root error boundary on every authenticated
   * route. Every menu that exists is opened here.
   */
  it.each([
    ['the notification bell', /^Notifications,/],
    ['the user menu', /^Account menu for/],
  ])('has no violations with %s menu open', async (_label, name) => {
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name }))

    // Finding the menu is what makes this a real check: a trigger that fails to
    // open asserts nothing, and axe over a closed menu is axe over no menu.
    const menu = await screen.findByRole('menu')
    // Not vacuous: a menu that opened empty would pass axe while asserting
    // nothing about the items this block exists to grade.
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })

  /**
   * The switcher is a combobox now, not a menu: the popup is a `dialog`
   * holding the search box and a `listbox`. Base UI portals it, and axe
   * exempts `role="dialog"` from `region` (as it does for the sheet), so this
   * one is graded at DOCUMENT scope with nothing narrowed.
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

    // Enforces in code what the KNOWN_INCOMPLETE comment claims: the trigger's
    // and the input's `aria-controls` both name a real element on the page,
    // which is exactly why their `aria-valid-attr-value` finding is axe
    // declining to fully resolve a reference rather than a broken one.
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

  it('has no violations with the theme menu open inside the mobile sheet', async () => {
    // ThemeToggle is not in the desktop shell - the mobile sheet is where it
    // renders, so that is where it has to be opened.
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    await screen.findByRole('dialog')
    await user.click(await screen.findByRole('button', { name: /Change theme/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })
})

/**
 * What axe cannot see: whether a focusable thing shows that it has focus.
 * axe has no layout and no cascade, so a removed outline with nothing in its
 * place is invisible to it. This is a class-level assertion for exactly that.
 */
describe('focus indicators', () => {
  // `Tabs` is not mounted by any route - `$slug.tsx` deliberately uses a nav of
  // real links instead, because those tabs are routes. The primitive is still
  // part of the approved set and is rendered directly here, which is the only
  // way its contract gets checked at all.
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

    // Base UI renders Tabs.Panel with `tabIndex: open ? 0 : -1`
    // (@base-ui/react@1.8.0, tabs/panel/TabsPanel.js:76), so an open panel is
    // reachable by keyboard. Suppressing its outline with nothing in its place
    // is a WCAG 2.4.7 failure, and it survived 243 tests and ten reviews.
    expect(panel).toHaveAttribute('tabindex', '0')
    expect(panel.className).toMatch(/focus-visible:/)
  })
})

/**
 * What axe cannot see: the order focus actually moves in, and where it lands
 * when an overlay closes.
 */
describe('keyboard', () => {
  it('tabs through the login form in the order the page reads', async () => {
    signOut()
    const user = userEvent.setup()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const expected = [
      screen.getByLabelText('Email'),
      screen.getByLabelText('Password'),
      screen.getByRole('button', { name: 'Sign in' }),
      // A plain anchor to a same-origin API route, not a button with a click
      // handler — so it is in the tab order for free.
      screen.getByRole('link', { name: 'Continue with Google' }),
      screen.getByRole('link', { name: 'Forgot password?' }),
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
    // Opened from the keyboard, not by a click: the restoration this checks is
    // only observable for a keyboard user.
    await user.tab()
    expect(document.activeElement).toBe(trigger)
    await user.keyboard('{Enter}')
    await screen.findByRole('menuitem', { name: 'Dark' })

    await user.keyboard('{Escape}')

    // Base UI restores focus asynchronously, after the popup unmounts.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })
})
