/**
 * The e2e fixture harness. Not part of the shipped app — nothing in `src/`
 * imports it, and `index.html` is the only Vite entry that builds.
 *
 * Playwright's `fixtures` project needs the REAL shell, the real router and
 * the real CSS in a real browser, but not a real backend. This boots the
 * actual router with MSW answering the same fixtures `tests/unit/a11y.test.tsx`
 * uses, and the same signed-in store state.
 *
 * `?state=loaded|empty|error|loading|soleowner` picks what the members
 * endpoint answers, which is how the e2e suite reaches the states that only
 * exist for one shape of data.
 *
 * `?access=platform` signs the harness user in as a staff viewer who is not a
 * member of `acme`, so the tenant pages render under the platform access
 * banner.
 */
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'
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
} from '../../tests/fixtures/ids'

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
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D' },
  },
]

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

const PREFERENCES = [
  { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'password_changed', emailEnabled: true, inAppEnabled: false },
]

/**
 * The Getting started checklist in progress, one required step done, so the
 * done and pending markers, the Optional badge, the links and Mark done are
 * all on the page. The member step's `completedAt` is the caller's own, so
 * staff (no membership) read it as null, as here.
 */
const ONBOARDING = {
  state: 'in_progress',
  steps: [
    {
      key: 'configure_settings',
      title: 'Configure your settings',
      description: 'Set the timezone and locale your team works in.',
      scope: 'tenant',
      kind: 'auto',
      required: true,
      completedAt: '2026-09-30T09:00:00.000Z',
      source: 'auto',
    },
    {
      key: 'invite_teammate',
      title: 'Invite a teammate',
      description: 'Bring someone else into this tenant.',
      scope: 'tenant',
      kind: 'auto',
      required: true,
      completedAt: null,
      source: null,
    },
    {
      key: 'teammate_joined',
      title: 'A teammate joins',
      description: 'Someone you invited accepts.',
      scope: 'tenant',
      kind: 'auto',
      required: false,
      completedAt: null,
      source: null,
    },
    {
      key: 'read_getting_started',
      title: 'Read the getting started guide',
      description: 'Each member marks this for themselves.',
      scope: 'member',
      kind: 'manual',
      required: false,
      completedAt: null,
      source: null,
    },
  ],
  requiredDone: 1,
  requiredTotal: 2,
  completedAt: null,
  dismissedAt: null,
}

/** The one current password the change-password handler below accepts. */
const HARNESS_PASSWORD = 'current-password'

const testUser = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null as 'viewer' | null,
}

function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return Response.json({ success: true, message, statusCode, data })
}

// `?state=` picks which variant to render, so the empty and error states get screenshots too rather than only the happy path.
const state = new URLSearchParams(location.search).get('state') ?? 'loaded'
const asStaff = new URLSearchParams(location.search).get('access') === 'platform'
if (asStaff) testUser.platformRole = 'viewer'
// `?state=suspended` lists the tenant as suspended, and its own detail 404s, as the API does.
const suspended = state === 'suspended'

const SOLE_OWNER = [MEMBERS[0]]

const membersHandler =
  state === 'soleowner'
    ? http.get('/api/v1/tenants/acme/members', () => ok(SOLE_OWNER, 'Members retrieved.'))
    : state === 'empty'
      ? http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.'))
      : state === 'error'
        ? http.get(
            '/api/v1/tenants/acme/members',
            () =>
              new Response(JSON.stringify({ success: false, message: 'Nope', statusCode: 500 }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              })
          )
        : state === 'loading'
          ? http.get('/api/v1/tenants/acme/members', () => new Promise<Response>(() => {}))
          : http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.'))

const worker = setupWorker(
  http.get('/api/v1/tenants', () =>
    ok(
      asStaff
        ? []
        : [
            {
              tenant: suspended ? { ...TENANT, lifecycleState: 'suspended' } : TENANT,
              role: 'owner',
            },
          ],
      'Tenants retrieved.'
    )
  ),
  http.get('/api/v1/tenants/acme', () =>
    suspended
      ? Response.json(
          { success: false, message: 'Tenant not found', statusCode: 404 },
          { status: 404 }
        )
      : ok(
          asStaff
            ? { ...TENANT, isPlatform: false, role: 'viewer', access: 'platform' }
            : { ...TENANT, isPlatform: false, role: 'owner', access: 'member' },
          'Tenant retrieved.'
        )
  ),
  membersHandler,
  // The members page lists pending invitations for an owner. Unmocked, this would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/tenants/acme/invitations', () => ok(INVITATIONS, 'Invitations retrieved.')),
  http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
  // Every overview mounts the Getting started card, staff's included. Unmocked, it would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/tenants/acme/onboarding', () => ok(ONBOARDING, 'Onboarding retrieved.')),
  http.get('/api/v1/tenants/acme/audit-log', () =>
    ok(
      {
        entries: [
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
        ],
        nextCursor: 'c2',
      },
      'Audit log retrieved.'
    )
  ),
  http.get('/api/v1/notifications', () =>
    ok({ notifications: NOTIFICATIONS }, 'Notifications retrieved.')
  ),
  http.get('/api/v1/notifications/preferences', () =>
    ok({ preferences: PREFERENCES }, 'Notification preferences retrieved.')
  ),
  /**
   * A stream that STAYS OPEN. Answering 204 looks to the hook exactly like
   * a dropped connection: it fires `error`, calls ensureSession(), and an
   * unmocked refresh request would fall through to the real API, come back
   * 401 and redirect the harness to /login mid-test. A test that is racing
   * a redirect is not testing what it says it is.
   */
  http.get(
    '/api/v1/notifications/stream',
    () =>
      new Response(
        new ReadableStream({ start: (controller) => controller.enqueue(': open\n\n') }),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        }
      )
  ),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // /profile's Security section. Unmocked, it would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [
          { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
          { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
        ],
        hasPassword: true,
      },
      'Auth providers retrieved.'
    )
  ),
  // Any other current password gets the API's own 400.
  http.post('/api/v1/auth/change-password', async ({ request }) => {
    const body = (await request.json()) as { currentPassword?: unknown }
    if (body.currentPassword === HARNESS_PASSWORD) return ok(null, 'Password has been changed.')
    return Response.json(
      {
        success: false,
        message: 'Current password is incorrect.',
        statusCode: 400,
        requestId: 'harness',
      },
      { status: 400 }
    )
  }),
  // Belt and braces: nothing in the fixtures suite should ever reach the real backend, and a silent fall-through is how it would.
  http.post('/api/v1/auth/refresh', () =>
    ok({ accessToken: 'harness-token', user: testUser }, 'Session refreshed.')
  )
)

await worker.start({ onUnhandledRequest: 'bypass', quiet: true })

// The real store state a signed-in user has. `isBootstrapped` skips the refresh round trip the root route would otherwise wait on.
useAuthStore.setState({
  accessToken: 'harness-token',
  user: testUser,
  isAuthenticated: true,
  isBootstrapped: true,
})

/**
 * Which in-app route to mount. Defaults to the members page, which is what
 * every `?state=` fixture is about, so the fixtures suite needs no
 * changes. `?path=` exists for the contrast suite and
 * `fixtures/security.test.ts`, which need the other authenticated
 * surfaces: the handlers above already answer /profile, /auth/providers,
 * /notifications, /notifications/preferences, /tenants, /tenants/acme and
 * its /settings and /onboarding, so those pages render without a backend.
 *
 * Only a same-origin absolute path is accepted. This harness is not
 * shipped (nothing in `src/` imports it, and `index.html` is the only Vite
 * entry that builds), but it does run against a real browser with a
 * signed-in store, and a query parameter that reached `replaceState`
 * unchecked would be an open-redirect shape worth never writing down in
 * the first place.
 */
const requestedPath = new URLSearchParams(location.search).get('path')
const targetPath =
  requestedPath && /^\/[^/\\]/.test(requestedPath) ? requestedPath : '/tenants/acme/members'

/**
 * replaceState, NOT router.navigate: navigate before the router mounts
 * does a real navigation, and the dev server then answers
 * /tenants/acme/members with the SPA fallback (index.html -> main.tsx), so
 * the harness never runs. The router reads location on mount, so setting
 * it first is enough.
 */
history.replaceState(null, '', targetPath + location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
