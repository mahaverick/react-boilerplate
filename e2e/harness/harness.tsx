/**
 * @file The e2e fixture harness: the real shell, router and CSS in a real
 * browser, with MSW answering the fixtures `tests/unit/a11y.test.tsx` uses and
 * the same signed-in store state, so the `fixtures` project needs no backend.
 * It is not part of the shipped app: nothing in `src/` imports it and
 * `index.html` is the only Vite entry that builds.
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
  TENANT_ID_2,
  TENANT_ID_9,
  USER_ID,
  USER_ID_2,
} from '../../tests/fixtures/ids'
import { listPage } from '../../tests/fixtures/list-page'

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
      role: 'editor',
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
    lastSentAt: null,
    resendAvailableAt: null,
  },
]

const NOTIFICATIONS = [
  {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: 'tenant_invitation',
    title: 'You are invited to Acme',
    body: 'A B invited you to join Acme Corp.',
    data: null,
    readAt: null,
    createdAt: '2026-01-02T09:00:00.000Z',
  },
  {
    id: NOTIFICATION_ID_2,
    userId: USER_ID,
    type: 'maintenance_mode_changed',
    title: 'Maintenance mode changed',
    body: 'Maintenance mode is now on.',
    data: null,
    readAt: '2026-01-02T10:00:00.000Z',
    createdAt: '2026-01-02T08:00:00.000Z',
  },
]

/** The tenant owner as the audit log names them. */
const AUDIT_ACTOR = { id: USER_ID, name: 'A B', email: 'a@b.com' }

const PREFERENCES = [
  { notificationType: 'tenant_invitation', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'maintenance_mode_changed', emailEnabled: true, inAppEnabled: false },
]

/**
 * The Getting started checklist in progress, with one required step done, so
 * the done and pending markers, the Optional badge and Mark done are all on
 * the page. The member step's `completedAt` is the caller's own, and the
 * harness user has not marked it yet.
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

const testUser = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null as 'viewer' | null,
  analyticsOptOut: false,
}

/**
 * The name and address `?pii=probe` gives every person in the fixtures, for
 * the DOM PII guard in `e2e/fixtures/pii.test.ts`; nothing may render them
 * unmasked. The invitation's address, which its preview and its `202` "Check
 * your inbox" name, becomes a probe too, and the signed-in probe user is one
 * half of every switch-account pair; the test puts the other half, and the
 * address a sign-in link goes to, in the URL or the form.
 */
const PROBE_NAME = { firstName: 'Pii', lastName: 'Probe' }
const PROBE_EMAIL = 'pii-probe@example.test'

/** An invitation addressed to someone else, so the accept page shows both addresses. */
const INVITATION_PREVIEW = {
  tenant: { name: TENANT.name, slug: TENANT.slug },
  role: 'editor',
  invitedBy: { firstName: 'A', lastName: 'B' },
  email: 'invitee@b.com',
}

if (new URLSearchParams(location.search).get('pii') === 'probe') {
  Object.assign(testUser, PROBE_NAME, { email: PROBE_EMAIL })
  MEMBERS.forEach((member, index) => {
    Object.assign(member.user, PROBE_NAME, {
      email: index === 0 ? PROBE_EMAIL : `pii-probe+member${index}@example.test`,
    })
  })
  for (const invitation of [...INVITATIONS, INVITATION_PREVIEW]) {
    invitation.email = 'pii-probe+invitee@example.test'
    if (invitation.invitedBy) Object.assign(invitation.invitedBy, PROBE_NAME)
  }
  NOTIFICATIONS[0]!.body = 'Pii Probe sent you a link.'
  Object.assign(AUDIT_ACTOR, { name: 'Pii Probe', email: PROBE_EMAIL })
}

/** An express success envelope as a `Response`, with `statusCode` as its HTTP status too. */
function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return Response.json({ success: true, message, statusCode, data }, { status: statusCode })
}

/** An express error envelope as a `Response`; `headers` carries a `Maintenance-Mode` answer. */
function fail(message: string, statusCode: number, code?: string, headers?: HeadersInit) {
  return Response.json(
    { success: false, message, statusCode, code, requestId: 'harness-request-id' },
    { status: statusCode, headers }
  )
}

/** express's 503 while maintenance is read-only, with the header that moves the app's mode. */
function readOnly() {
  return fail('The service is read-only for maintenance.', 503, 'READ_ONLY_MODE', {
    'Maintenance-Mode': 'read_only',
  })
}

const params = new URLSearchParams(location.search)

/**
 * `?session=none` starts signed out: the store is settled with no user, so no
 * bootstrap refresh runs, and a refresh answers 401 as express does without a
 * cookie. Only public routes (`/login`, `/auth/link`, the invitation pages)
 * render under it; a signed-in route sends it to `/login`.
 */
const signedOut = params.get('session') === 'none'
/** Whether the browser holds a refresh cookie: from the start when signed in, else once a link or an invitation signed it in. */
let hasRefreshCookie = !signedOut

/**
 * `?link=` picks what `POST /auth/link/verify` answers: `ok` (the default)
 * signs the harness user in, `new` does so as a new account (and the tenant
 * list starts empty until a workspace is created), `dead` is the 400
 * `LINK_INVALID`, and `readonly` the 503 `READ_ONLY_MODE` with its
 * `Maintenance-Mode` header.
 */
const linkMode = params.get('link') ?? 'ok'

/**
 * `?invite=` picks the invitation answers. With none, the preview is for
 * another address, so a signed-in user is asked before switching. `ok` makes
 * the preview the harness user's: signed in, the page accepts; signed out, the
 * verify signs in and joins at once. `inbox` answers the verify with the `202`
 * "Check your inbox" for the preview's address. `dead` 404s the preview, the
 * verify and the accept. `joined` 404s the preview, as for a used link, and the
 * accept answers `alreadyMember`.
 */
const inviteMode = params.get('invite')

/**
 * `?confirm=` picks what `POST /invitations/confirm` answers: `ok` (the
 * default) signs the harness user in and joins Acme, `dead` is the 404
 * `invitation_invalid`, and `readonly` the 503 `READ_ONLY_MODE`.
 */
const confirmMode = params.get('confirm') ?? 'ok'

/**
 * `?state=` picks what the members endpoint answers: `loaded` (the default),
 * `empty`, `error`, `loading` or `soleowner`. `viewer` or `admin` makes the
 * harness user that role in `acme`, with Cleo D its owner, so their own row
 * offers Leave. `suspended` lists the tenant as suspended and 404s its detail,
 * as the API does.
 */
const state = new URLSearchParams(location.search).get('state') ?? 'loaded'
/** `?access=platform` signs in a staff viewer who is not a member of `acme`, so tenant pages render under the platform access banner. */
const asStaff = new URLSearchParams(location.search).get('access') === 'platform'
if (asStaff) testUser.platformRole = 'viewer'
const suspended = state === 'suspended'
/** `?tenants=many` lists Beta Inc and the suspended Gamma Ltd beside Acme, for the palette's Switch tenant. */
const manyTenants = new URLSearchParams(location.search).get('tenants') === 'many'
/**
 * Whether the harness user belongs to Acme yet. `?tenants=none`, and a new
 * account from `?link=new`, start with no tenant, as `/welcome` expects; a
 * created workspace joins the list.
 */
let hasTenant = params.get('tenants') !== 'none' && linkMode !== 'new'
const MORE_TENANTS = manyTenants
  ? [
      { ...TENANT, id: TENANT_ID_2, name: 'Beta Inc', slug: 'beta' },
      { ...TENANT, id: TENANT_ID_9, name: 'Gamma Ltd', slug: 'gamma', lifecycleState: 'suspended' },
    ].map((tenant) => ({
      tenant,
      role: 'owner',
      isPlatform: false,
      joinedAt: '2026-01-01T00:00:00.000Z',
    }))
  : []

const SOLE_OWNER = [MEMBERS[0]]

/** The harness user's role in `acme` for `?state=viewer|admin`; Cleo D is then the owner. */
const selfRole = state === 'viewer' || state === 'admin' ? state : null
const NON_OWNER_MEMBERS = MEMBERS.map((entry, index) => ({
  ...entry,
  membership: { ...entry.membership, role: index === 0 ? (selfRole ?? 'owner') : 'owner' },
}))

/** Every react flag at its fallback, as express answers when no flag is on. */
const FLAG_FALLBACKS = { example_beta_page: false, example_cta_experiment: 'control' }

/**
 * `?flags=network` leaves the flag reads, their exposure reports and the beta
 * route unmocked, so `e2e/fixtures/flags.test.ts` answers them with
 * `context.route`; otherwise every flag is at its fallback.
 */
const flagHandlers =
  new URLSearchParams(location.search).get('flags') === 'network'
    ? []
    : [
        http.get('/api/v1/flags', () =>
          ok({ flags: FLAG_FALLBACKS, evaluatedAt: '2026-10-05T09:00:00.000Z' }, 'Flags.')
        ),
        http.get('/api/v1/tenants/acme/flags', () =>
          ok({ flags: FLAG_FALLBACKS, evaluatedAt: '2026-10-05T09:00:00.000Z' }, 'Flags.')
        ),
        http.post(
          '/api/v1/tenants/acme/flags/exposures',
          () => new Response(null, { status: 204 })
        ),
      ]

const membersHandler =
  state === 'soleowner'
    ? http.get('/api/v1/tenants/acme/members', () => ok(listPage(SOLE_OWNER), 'Members retrieved.'))
    : state === 'empty'
      ? http.get('/api/v1/tenants/acme/members', () => ok(listPage([]), 'Members retrieved.'))
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
          : http.get('/api/v1/tenants/acme/members', () =>
              ok(listPage(selfRole ? NON_OWNER_MEMBERS : MEMBERS), 'Members retrieved.')
            )

/**
 * `?hold=` and `?fail=` each take comma-separated API paths
 * (`/api/v1/notifications`), matched exactly as MSW path patterns (a `:param`
 * segment matches any value; there is no prefix match), for every method, so
 * a held POST such as `/api/v1/auth/link/verify` or
 * `/api/v1/invitations/verify` stays pending too. A held path never answers
 * and a failed one answers 500, so a fixture can show that one section's
 * request changes only that section. Only `/api/v1/` paths are taken. These
 * handlers come first, so they win over the defaults below.
 */
const sectionParams = new URLSearchParams(location.search)
/** The `/api/v1/` paths listed under `key`. */
const pathsOf = (key: string) =>
  (sectionParams.get(key) ?? '').split(',').filter((path) => path.startsWith('/api/v1/'))
const sectionHandlers = [
  ...pathsOf('hold').map((path) => http.all(path, () => new Promise<Response>(() => {}))),
  ...pathsOf('fail').map((path) =>
    http.all(
      path,
      () =>
        new Response(
          JSON.stringify({ success: false, message: 'Harness failure', statusCode: 500 }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    )
  ),
]

const worker = setupWorker(
  ...sectionHandlers,
  // The signed-in layout reads the page's flags on every route; unmocked, they 401 and sign the harness user out.
  ...flagHandlers,
  http.get('/api/v1/tenants', () =>
    ok(
      listPage(
        asStaff || !hasTenant
          ? []
          : [
              {
                tenant: suspended ? { ...TENANT, lifecycleState: 'suspended' } : TENANT,
                role: selfRole ?? 'owner',
                isPlatform: false,
                joinedAt: '2026-01-01T00:00:00.000Z',
              },
              ...MORE_TENANTS,
            ]
      ),
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
            : {
                ...TENANT,
                isPlatform: false,
                role: selfRole ?? 'owner',
                access: 'member',
              },
          'Tenant retrieved.'
        )
  ),
  membersHandler,
  // The first-tenant step's create: Acme joins the list, so its pages answer the landing.
  http.post('/api/v1/tenants', () => {
    hasTenant = true
    return ok(TENANT, 'Tenant created.', 201)
  }),
  http.delete('/api/v1/tenants/acme/membership', () => ok(null, 'You left the tenant.')),
  // The members page lists pending invitations for an owner; unmocked, this 401s and signs the harness user out.
  http.get('/api/v1/tenants/acme/invitations', () =>
    ok(listPage(INVITATIONS), 'Invitations retrieved.')
  ),
  http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
    ok(null, 'If that address can be invited, an invitation has been sent.')
  ),
  http.post('/api/v1/invitations/preview', () =>
    inviteMode === 'dead' || inviteMode === 'joined'
      ? fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
      : ok(
          inviteMode === 'ok'
            ? { ...INVITATION_PREVIEW, email: testUser.email }
            : INVITATION_PREVIEW,
          'Invitation retrieved.'
        )
  ),
  http.post('/api/v1/invitations/verify', () => {
    if (inviteMode === 'dead' || inviteMode === 'joined') {
      return fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
    }
    if (inviteMode === 'inbox') {
      return ok(
        { confirmationSent: true, email: INVITATION_PREVIEW.email },
        'Check your inbox to finish joining.',
        202
      )
    }
    hasRefreshCookie = true
    return ok(
      {
        user: testUser,
        accessToken: 'harness-token',
        isNewUser: true,
        tenant: INVITATION_PREVIEW.tenant,
        role: INVITATION_PREVIEW.role,
      },
      'Invitation accepted.'
    )
  }),
  http.post('/api/v1/invitations/accept', () =>
    inviteMode === 'dead'
      ? fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
      : ok(
          {
            tenant: INVITATION_PREVIEW.tenant,
            role: INVITATION_PREVIEW.role,
            alreadyMember: inviteMode === 'joined',
          },
          'Invitation accepted.'
        )
  ),
  http.post('/api/v1/invitations/confirm', () => {
    if (confirmMode === 'dead') {
      return fail(
        "We couldn't use this link. Open your invitation email and select Join again, or ask the person who invited you for a new invite.",
        404,
        'invitation_invalid'
      )
    }
    if (confirmMode === 'readonly') return readOnly()
    hasRefreshCookie = true
    return ok(
      {
        user: testUser,
        accessToken: 'harness-token',
        isNewUser: false,
        tenant: INVITATION_PREVIEW.tenant,
        role: INVITATION_PREVIEW.role,
      },
      'Invitation accepted.'
    )
  }),
  http.post('/api/v1/auth/link/request', () =>
    ok(null, 'Check your inbox for a sign-in link.', 202)
  ),
  http.post('/api/v1/auth/link/verify', () => {
    if (linkMode === 'dead') {
      return fail('This link has expired or was already used.', 400, 'LINK_INVALID')
    }
    if (linkMode === 'readonly') return readOnly()
    hasRefreshCookie = true
    return ok(
      {
        user: testUser,
        accessToken: 'harness-token',
        isNewUser: linkMode === 'new',
        redirect: null,
      },
      'Signed in.'
    )
  }),
  http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
  // Every overview mounts the Getting started card, staff's included; unmocked, it 401s and signs the harness user out.
  http.get('/api/v1/tenants/acme/onboarding', () => ok(ONBOARDING, 'Onboarding retrieved.')),
  http.get('/api/v1/tenants/acme/audit-log', () =>
    ok(
      listPage(
        [
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
            actor: AUDIT_ACTOR,
            target: { type: 'tenant', id: TENANT_ID },
            metadata: { name: 'Acme Corp', slug: 'acme' },
          },
        ],
        { nextCursor: 'c2', hasNext: true }
      ),
      'Audit log retrieved.'
    )
  ),
  http.get('/api/v1/notifications', ({ request }) => {
    // The bell and the nav badge read the unread view's total; the inbox reads all of them.
    const unreadOnly = new URL(request.url).searchParams.get('unread') === 'true'
    const rows = unreadOnly
      ? NOTIFICATIONS.filter((notification) => notification.readAt === null)
      : NOTIFICATIONS
    return ok(listPage(rows, {}, { count: rows.length, capped: false }), 'Notifications retrieved.')
  }),
  http.get('/api/v1/notifications/preferences', () =>
    ok({ preferences: PREFERENCES }, 'Notification preferences retrieved.')
  ),
  http.put('/api/v1/notifications/preferences', () =>
    ok({ preferences: PREFERENCES }, 'Notification preferences updated.')
  ),
  /**
   * A stream that stays open. A 204 has no body, so the hook treats it as a refused connect:
   * it reconnects with the same token on its backoff, and a test would race that traffic.
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
  // The Security settings page reads this; unmocked, it 401s and signs the harness user out.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [
          { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
          { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
        ],
      },
      'Auth providers retrieved.'
    )
  ),
  http.post('/api/v1/auth/sessions/revoke-others', () =>
    ok({ revoked: 2 }, 'Other sessions signed out.')
  ),
  // A refresh with no handler would bypass MSW and 401, which signs the harness user out.
  http.post('/api/v1/auth/refresh', () =>
    hasRefreshCookie
      ? ok({ accessToken: 'harness-token', user: testUser }, 'Session refreshed.')
      : fail('Missing refresh token', 401)
  )
)

await worker.start({ onUnhandledRequest: 'bypass', quiet: true })

// The real store state a signed-in (or, for `?session=none`, signed-out) user has. `isBootstrapped` skips the refresh round trip the root route would otherwise wait on.
useAuthStore.setState(
  signedOut
    ? { accessToken: null, user: null, isAuthenticated: false, isBootstrapped: true }
    : { accessToken: 'harness-token', user: testUser, isAuthenticated: true, isBootstrapped: true }
)

/**
 * `?path=` picks the in-app route to mount, defaulting to the members page
 * that every `?state=` fixture is about. The contrast suite and
 * `fixtures/security.test.ts` use it to reach the other authenticated
 * surfaces, whose endpoints the handlers above answer.
 *
 * Only a same-origin absolute path is accepted: the harness runs in a real
 * browser with a signed-in store, and a query parameter that reached
 * `replaceState` unchecked would be an open-redirect shape.
 */
const requestedPath = new URLSearchParams(location.search).get('path')
const targetPath =
  requestedPath && /^\/[^/\\]/.test(requestedPath)
    ? requestedPath
    : '/settings/workspace/acme/members'

// replaceState, not router.navigate: before the router mounts, navigate does a real navigation and the dev server answers it with the SPA fallback (index.html), so the harness never runs.
history.replaceState(
  null,
  '',
  // A path that holds its own query gets the harness keys after an `&`, never a second `?`.
  targetPath.includes('?')
    ? `${targetPath}&${location.search.slice(1)}`
    : targetPath + location.search
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
