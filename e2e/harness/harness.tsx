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
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'

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

const testUser = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null as 'viewer' | null,
}

function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return Response.json({ success: true, message, statusCode, data })
}

// `?state=` picks which variant to render, so the empty and error states get
// screenshots too rather than only the happy path.
const state = new URLSearchParams(location.search).get('state') ?? 'loaded'
const asStaff = new URLSearchParams(location.search).get('access') === 'platform'
if (asStaff) testUser.platformRole = 'viewer'

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
          ? http.get('/api/v1/tenants/acme/members', async () => {
              await new Promise((r) => setTimeout(r, 1_000_000))
              return ok(MEMBERS, 'Members retrieved.')
            })
          : http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.'))

const worker = setupWorker(
  http.get('/api/v1/tenants', () =>
    ok(asStaff ? [] : [{ tenant: TENANT, role: 'owner' }], 'Tenants retrieved.')
  ),
  http.get('/api/v1/tenants/acme', () =>
    ok(
      asStaff
        ? { ...TENANT, isPlatform: false, role: 'viewer', access: 'platform' }
        : { ...TENANT, isPlatform: false, role: 'owner', access: 'member' },
      'Tenant retrieved.'
    )
  ),
  membersHandler,
  // The members page lists pending invitations for an owner. Unmocked, this
  // would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/tenants/acme/invitations', () => ok(INVITATIONS, 'Invitations retrieved.')),
  http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
  http.get('/api/v1/tenants/acme/audit-log', () =>
    ok(
      {
        entries: [
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
  // A stream that STAYS OPEN. Answering 204 looks to the hook exactly like a
  // dropped connection: it fires `error`, calls ensureSession(), and that
  // request — unmocked — used to fall through to the real API, come back 401
  // and redirect the harness to /login mid-test. A test that is racing a
  // redirect is not testing what it says it is.
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
  // Belt and braces: nothing in the fixtures suite should ever reach the real
  // backend, and a silent fall-through is how it did.
  http.post('/api/v1/auth/refresh', () =>
    ok({ accessToken: 'harness-token', user: testUser }, 'Session refreshed.')
  )
)

await worker.start({ onUnhandledRequest: 'bypass', quiet: true })

// The real store state a signed-in user has. `isBootstrapped` skips the
// refresh round trip the root route would otherwise wait on.
useAuthStore.setState({
  accessToken: 'harness-token',
  user: testUser,
  isAuthenticated: true,
  isBootstrapped: true,
})

// Which in-app route to mount. Defaults to the members page, which is what
// every `?state=` fixture is about — so the fixtures suite needs no changes
// and reads exactly as it did before this parameter existed. `?path=` exists
// for the CONTRAST suite, which needs to reach the other authenticated
// surfaces: the handlers above already answer /profile, /notifications,
// /notifications/preferences, /tenants, /tenants/acme and its /settings, so
// those pages render fully without a backend and only ever lacked a way in.
//
// Only a same-origin absolute path is accepted. This harness is not shipped
// (nothing in `src/` imports it, and `index.html` is the only Vite entry that
// builds), but it does run against a real browser with a signed-in store, and
// a query parameter that reached `replaceState` unchecked would be an
// open-redirect shape worth never writing down in the first place.
const requestedPath = new URLSearchParams(location.search).get('path')
const targetPath =
  requestedPath && /^\/[^/\\]/.test(requestedPath) ? requestedPath : '/tenants/acme/members'

// replaceState, NOT router.navigate: navigate before the router mounts does a
// real navigation, and the dev server then answers /tenants/acme/members with
// the SPA fallback (index.html -> main.tsx), so the harness never runs. The
// router reads location on mount, so setting it first is enough.
history.replaceState(null, '', targetPath + location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
