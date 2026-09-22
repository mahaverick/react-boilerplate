import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * THE ACCESSIBILITY GATE. Spec section 9's criteria, made enforceable.
 *
 * Three things about this file are deliberate and easy to undo by accident:
 *
 * 1. WHAT COLOUR CONTRAST IS NOT CHECKED HERE. jest-axe disables every
 *    `cat.color` rule by default because contrast cannot be computed in jsdom,
 *    which has no layout and no cascade — see `AXE_RULES_COLOR` in
 *    node_modules/jest-axe/index.js ("Color contrast checking doesnt work in a
 *    jsdom environment"). A green run on this file therefore says NOTHING about
 *    contrast. That criterion is verified in a browser, and the automated
 *    version of it belongs to the Phase B Playwright gate.
 *
 * 2. NO RULE IS TURNED OFF. jest-axe's defaults are used as they come,
 *    `region` included. An earlier round claimed `region` would flag the
 *    sidebar's header and footer; measured, it does not — everything in there
 *    sits inside a `button` or an `a`, which the rule excludes — and the rule
 *    genuinely runs (a stray `<p>` appended to `document.body` IS flagged).
 *    If something starts tripping a rule, fix the markup.
 *
 * 3. `axe(document.body)`, NOT the render container. Base UI portals every
 *    popup — dialog, sheet, menu, select — to `document.body`, OUTSIDE the
 *    container Testing Library renders into. Axing the container would silently
 *    skip the exact markup the two open-overlay tests below exist to check.
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
    http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
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
 * Asserts the WHOLE document is clean, portals included.
 *
 * That this verdict means anything is itself asserted, by the first test
 * below: a rule set that silently stopped running would make every page here
 * "pass". The probe there is `region` specifically, since that is the rule an
 * earlier round wanted disabled.
 */
async function expectNoViolations() {
  expect(await axe(document.body)).toHaveNoViolations()
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
      expect(await axe(document.body)).not.toHaveNoViolations()
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
    ['tenant members', '/tenants/acme/members', () => screen.findByRole('table')],
    [
      'tenant settings',
      '/tenants/acme/settings',
      () => screen.findByRole('button', { name: 'Save settings' }),
    ],
  ])('%s has no axe violations', async (_name, path, ready) => {
    renderAppAt(path)
    await ready()
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
