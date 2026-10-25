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
import type { RazorpayOptions } from '@/lib/razorpay-checkout'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import type {
  BillingInterval,
  CheckoutSession,
  TenantBilling,
  TenantEntitlements,
  UpgradeSurface,
} from '@/types/billing.types'
import {
  BILLING_STATES,
  billingState,
  membersUsage,
  testEntitlements,
  testPlans,
  testUpgradeRequest,
  type BillingStateName,
} from '../../tests/fixtures/billing'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  INVITATION_ID,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  NOTIFICATION_ID,
  NOTIFICATION_ID_2,
  PASSKEY_ID,
  PASSKEY_ID_2,
  PASSKEY_ID_3,
  STAFF_USER_ID,
  TENANT_ID,
  TENANT_ID_2,
  TENANT_ID_9,
  USER_ID,
  USER_ID_2,
} from '../../tests/fixtures/ids'
import { listPage } from '../../tests/fixtures/list-page'
import { USER_HANDLE } from '../../tests/fixtures/user-handle'

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
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    userId: USER_ID,
    type: 'billing_payment_failed',
    title: 'Your payment of ₹999 failed',
    body: 'Update your card to keep Paid.',
    metadata: { tenantId: TENANT_ID, slug: 'acme' },
    readAt: null,
    createdAt: '2026-01-02T07:00:00.000Z',
  },
]

/** The tenant owner as the audit log names them. */
const AUDIT_ACTOR = { id: USER_ID, name: 'A B', email: 'a@b.com' }

const PREFERENCES = [
  { notificationType: 'tenant_invitation', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'maintenance_mode_changed', emailEnabled: true, inAppEnabled: false },
  { notificationType: 'billing_trial_ending', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'billing_payment_failed', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'billing_payer_left', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'billing_upgrade_requested', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'billing_paid_cancelled', emailEnabled: true, inAppEnabled: true },
  { notificationType: 'workspace_full', emailEnabled: true, inAppEnabled: true },
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
function fail(
  message: string,
  statusCode: number,
  code?: string,
  headers?: HeadersInit,
  extra: Record<string, unknown> = {}
) {
  return Response.json(
    { success: false, message, statusCode, code, ...extra, requestId: 'harness-request-id' },
    { status: statusCode, headers }
  )
}

/** express's `INVITATION_INVALID_MESSAGE`, its one answer for every dead invitation. */
const INVITATION_INVALID =
  'This invitation link has expired or was already used. Ask the person who invited you for a new one.'

/** express's 503 while maintenance is read-only: its `mode` and `since`, `Retry-After`, and the header that moves the app's mode. */
function readOnly() {
  return fail(
    'The service is read-only for maintenance.',
    503,
    'READ_ONLY_MODE',
    { 'Maintenance-Mode': 'read_only', 'Retry-After': '30' },
    { mode: 'read_only', since: null }
  )
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
 * `empty`, `error`, `loading` or `soleowner`. `viewer`, `editor` or `admin`
 * makes the harness user that role in `acme`, with Cleo D its owner, so their
 * own row offers Leave. `suspended` lists the tenant as suspended and 404s its detail,
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

/** The harness user's role in `acme` for `?state=viewer|editor|admin`; Cleo D is then the owner. */
const selfRole = state === 'viewer' || state === 'editor' || state === 'admin' ? state : null
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
        http.get(
          '/api/v1/flags',
          () =>
            setupRefusal() ??
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

/** The probe's passkey name, for `?pii=probe`: the first row carries it. */
const PROBE_PASSKEY_NAME = 'Pii Probe’s phone'

/**
 * `?passkeys=off|optional|required` sets the config mode (default `optional`).
 * In `off` every passkey route but the config answers express's unknown-route 404.
 */
const passkeyMode = (params.get('passkeys') ?? 'optional') as 'off' | 'optional' | 'required'

/**
 * `?setup=1` is required mode for an account with no passkey yet: `/flags`,
 * `/tenants` and `POST /auth/passkeys/step-up/options` answer 403
 * `PASSKEY_SETUP_REQUIRED` until a registration verify succeeds, as express's
 * allowlist does. It also starts the list empty unless `?passkeyList=` says otherwise.
 */
const setupMode = params.get('setup') === '1'
let setupDone = !setupMode

/** `?passkeyList=none|one|two` (default `two`, or `none` under `?setup=1`). */
const passkeyListMode = params.get('passkeyList') ?? (setupMode ? 'none' : 'two')

/**
 * `?stepUp=stale|fresh` (default `fresh`). `stale` answers registration options
 * and DELETE with 401 `REAUTH_REQUIRED` until a passkey or link step-up verify succeeds.
 */
let stepUpFresh = params.get('stepUp') !== 'stale'

/** The harness user's passkeys, oldest first; a registration appends, a delete removes. */
const passkeys = [
  {
    id: PASSKEY_ID,
    name: params.get('pii') === 'probe' ? PROBE_PASSKEY_NAME : 'MacBook Touch ID',
    provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
    synced: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    lastUsedAt: '2026-10-01T10:00:00.000Z',
    credentialId: 'Y3JlZGVudGlhbC0x',
  },
  {
    id: PASSKEY_ID_2,
    name: 'Work security key',
    provider: { name: 'YubiKey 5', iconLight: null, iconDark: null },
    synced: false,
    createdAt: '2026-09-15T10:00:00.000Z',
    lastUsedAt: null,
    credentialId: 'Y3JlZGVudGlhbC0y',
  },
].slice(0, passkeyListMode === 'none' ? 0 : passkeyListMode === 'one' ? 1 : 2)

/** express's unknown-route 404, which every passkey route but the config answers in `off` mode. */
function unknownRoute() {
  return fail('Route not found', 404, 'not_found')
}

/** The 403 that required mode answers while the account has no passkey, or null once it has one. */
function setupRefusal() {
  return setupDone
    ? null
    : fail(
        'Create a passkey to continue. Every account here needs one.',
        403,
        'PASSKEY_SETUP_REQUIRED'
      )
}

/** The 401 a stale sign-in answers for a write that needs a recent confirmation, or null when fresh. */
function reauthRefusal() {
  return stepUpFresh ? null : fail('Confirm it’s you to continue.', 401, 'REAUTH_REQUIRED')
}

/** A request challenge for `rpId` `localhost`, the harness's origin. */
function requestOptions() {
  return {
    challenge: 'aGFybmVzcy1jaGFsbGVuZ2U',
    rpId: 'localhost',
    timeout: 60000,
    userVerification: 'required',
  }
}

/**
 * A 400 when the request body is not exactly `expected` (the contract's strict bodies), else
 * `null`. Keeps a wrong wire shape from passing through the harness unseen.
 */
async function wrongBody(request: Request, expected: Record<string, unknown>) {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as unknown
  return JSON.stringify(body) === JSON.stringify(expected)
    ? null
    : fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
}

/** The list answer: the passkeys and the user handle. */
function passkeyList() {
  return { passkeys, userHandle: USER_HANDLE }
}

/** Handlers for the twelve passkey and step-up calls of the contract. */
const passkeyHandlers = [
  http.get('/api/v1/auth/passkeys/config', () =>
    ok({ mode: passkeyMode, rpId: 'localhost' }, 'Passkey config retrieved.')
  ),
  http.post('/api/v1/auth/passkeys/sign-in/options', async ({ request }) =>
    passkeyMode === 'off'
      ? unknownRoute()
      : ((await wrongBody(request, {})) ??
        ok({ challengeId: 'harness-sign-in', options: requestOptions() }, 'Options.'))
  ),
  http.post('/api/v1/auth/passkeys/sign-in/verify', () => {
    if (passkeyMode === 'off') return unknownRoute()
    hasRefreshCookie = true
    return ok(
      { user: testUser, accessToken: 'harness-token', isNewUser: false, redirect: null },
      'Signed in.'
    )
  }),
  http.post('/api/v1/auth/passkeys/step-up/options', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const malformed = await wrongBody(request, {})
    if (malformed) return malformed
    const refusal = setupRefusal()
    if (refusal) return refusal
    if (passkeys.length === 0) {
      return fail('You have no passkey to confirm with.', 409, 'NO_PASSKEY')
    }
    return ok({ challengeId: 'harness-step-up', options: requestOptions() }, 'Options.')
  }),
  http.post('/api/v1/auth/passkeys/step-up/verify', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    // Strict body: `app` is not accepted here.
    if (
      'app' in
      ((await request
        .clone()
        .json()
        .catch(() => ({}))) as object)
    ) {
      return fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
    }
    stepUpFresh = true
    return ok({ accessToken: 'harness-token-confirmed' }, 'Confirmed.')
  }),
  http.post('/api/v1/auth/step-up/link/request', () =>
    ok({ resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }, 'Link sent.', 202)
  ),
  http.post('/api/v1/auth/step-up/link/verify', () => {
    stepUpFresh = true
    return ok({ accessToken: 'harness-token-confirmed' }, 'Confirmed.')
  }),
  http.get('/api/v1/auth/passkeys', () =>
    passkeyMode === 'off' ? unknownRoute() : ok(passkeyList(), 'Passkeys retrieved.')
  ),
  http.post('/api/v1/auth/passkeys/registration/options', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const malformed = await wrongBody(request, { app: 'web' })
    if (malformed) return malformed
    const stale = reauthRefusal()
    if (stale) return stale
    return ok(
      {
        challengeId: 'harness-registration',
        options: {
          challenge: 'aGFybmVzcy1jaGFsbGVuZ2U',
          rp: { id: 'localhost', name: 'Harness' },
          user: { id: USER_HANDLE, name: testUser.email, displayName: 'A B' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        },
      },
      'Options.'
    )
  }),
  http.post('/api/v1/auth/passkeys/registration/verify', () => {
    if (passkeyMode === 'off') return unknownRoute()
    const stale = reauthRefusal()
    if (stale) return stale
    const passkey = {
      id: PASSKEY_ID_3,
      name: 'Passkey 3',
      provider: { name: 'Chrome on Mac', iconLight: null, iconDark: null },
      synced: false,
      createdAt: '2026-10-21T10:00:00.000Z',
      lastUsedAt: null,
      credentialId: 'Y3JlZGVudGlhbC0z',
    }
    passkeys.push(passkey)
    setupDone = true
    return ok({ passkey }, 'Passkey created.', 201)
  }),
  http.patch('/api/v1/auth/passkeys/:id', async ({ params: route, request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const passkey = passkeys.find((row) => row.id === route.id)
    if (!passkey) return fail('Passkey not found', 404, 'passkey_not_found')
    passkey.name = ((await request.json()) as { name: string }).name
    return ok({ passkey }, 'Passkey renamed.')
  }),
  http.delete('/api/v1/auth/passkeys/:id', ({ params: route, request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    if (new URL(request.url).searchParams.get('app') !== 'web') {
      return fail('Query does not match the contract.', 400, 'VALIDATION_ERROR')
    }
    const stale = reauthRefusal()
    if (stale) return stale
    const index = passkeys.findIndex((row) => row.id === route.id)
    if (index === -1) return fail('Passkey not found', 404, 'passkey_not_found')
    if (passkeys.length === 1 && passkeyMode === 'required') {
      return fail(
        'Your account needs at least one passkey. Create another before you delete this one.',
        409,
        'LAST_PASSKEY'
      )
    }
    passkeys.splice(index, 1)
    return ok(passkeyList(), 'Passkey deleted.')
  }),
]

/**
 * `?billing=` picks the billing state every tenant reads (`trialing`, the
 * default: a Paid trial with 9 days left), from `BILLING_STATES` in
 * `tests/fixtures/billing.ts`. `payments_off` also turns payments off in
 * `GET /plans`. `?members=N` sets how many members the members limit counts.
 * The billing writes change the state the next reads answer, as express does,
 * so a flow can be followed to its end. Under `?pii=probe` the payer, the
 * payer who left and the billing email are the probe's, and two probe members
 * have asked to upgrade.
 */
const billingParam = params.get('billing') ?? 'trialing'
const billingName: BillingStateName = BILLING_STATES.includes(billingParam as BillingStateName)
  ? (billingParam as BillingStateName)
  : 'trialing'
const piiProbe = params.get('pii') === 'probe'
const billingFixture = billingState(
  billingName,
  piiProbe
    ? { payerName: 'Pii Probe', formerPayerName: 'Pii Probe', billingEmail: PROBE_EMAIL }
    : undefined
)
let billingView: TenantBilling = billingFixture.billing
let entitlementsView: TenantEntitlements = billingFixture.entitlements
const membersParam = params.get('members')
if (membersParam !== null && /^\d+$/.test(membersParam)) {
  const members = entitlementsView.limits.members ?? membersUsage(0, null)
  entitlementsView = {
    ...entitlementsView,
    limits: {
      ...entitlementsView.limits,
      members: membersUsage(Number(membersParam), members.limit),
    },
  }
}
const PLANS = { ...testPlans, paymentsEnabled: billingFixture.paymentsEnabled }
const UPGRADE_REQUESTS = piiProbe
  ? [
      testUpgradeRequest({ requestedBy: { userId: USER_ID_2, name: 'Pii Probe' } }),
      testUpgradeRequest({
        id: 'upgrade-request-2',
        requestedBy: { userId: USER_ID, name: 'Pii Probe' },
        createdAt: '2026-10-21T09:00:00.000Z',
      }),
    ]
  : []

/** The period end a Paid subscription started in the harness runs to: "25 November 2026". */
const NEW_PERIOD_END = '2026-11-25T10:00:00.000Z'

/** The checkout the last start, switch or card-change write opened, which the confirm completes. */
let pendingCheckout: CheckoutSession | null = null

/**
 * A checkout session as express answers it. The first charge is deferred to
 * the trial's end for an upgrade during the trial, and to the period's end for
 * a switch or Paid again while cancelling.
 */
function checkoutSession(
  purpose: CheckoutSession['purpose'],
  interval: BillingInterval
): CheckoutSession {
  const price = PLANS.plans[1]!.prices.find((row) => row.interval === interval)!
  const startsAt =
    purpose === 'upgrade' && billingView.state === 'trialing'
      ? billingView.trialEndsAt
      : purpose === 'switch' || (purpose === 'upgrade' && billingView.cancelAtPeriodEnd)
        ? billingView.currentPeriodEnd
        : null
  pendingCheckout = {
    purpose,
    keyId: 'rzp_test_harness',
    subscriptionId: `sub_harness_${purpose}`,
    amountMinor: price.amountMinor,
    currency: 'INR',
    interval,
    startsAt,
    prefill: { name: `${testUser.firstName} ${testUser.lastName}`, email: testUser.email },
  }
  return pendingCheckout
}

/** The interval a checkout write asked for, or `null` for a body the contract refuses. */
async function intervalOf(request: Request): Promise<BillingInterval | null> {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { interval?: unknown } | null
  return body?.interval === 'month' || body?.interval === 'year' ? body.interval : null
}

/** Every upgrade surface express's `UPGRADE_SURFACES` lists; the record makes a missing one a type error. */
const UPGRADE_SURFACE_SET: Record<UpgradeSurface, true> = {
  limit: true,
  feature: true,
  banner: true,
  billing_page: true,
  pricing: true,
}

/**
 * A 400 when an upgrade request's body is not express's strict
 * `{ key?, surface }`: a known surface, and a catalog key when there is one;
 * else `null`.
 */
async function wrongUpgradeRequest(request: Request) {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null
  const keys = body === null || typeof body !== 'object' ? [] : Object.keys(body)
  const valid =
    body !== null &&
    keys.every((key) => key === 'key' || key === 'surface') &&
    typeof body.surface === 'string' &&
    Object.hasOwn(UPGRADE_SURFACE_SET, body.surface) &&
    (!('key' in body) || testPlans.catalog.some((entry) => entry.key === body.key))
  return valid ? null : fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
}

/** Moves the workspace onto Free, as a cancel of a past-due subscription does. */
function moveToFree(): void {
  const free = billingState('free')
  billingView = { ...free.billing, paymentsEnabled: billingView.paymentsEnabled }
  entitlementsView = free.entitlements
}

/** The confirm's effect on the view, by what the pending checkout was for. */
function applyCheckout(session: CheckoutSession): void {
  if (session.purpose === 'card_change') return
  if (session.purpose === 'switch' || billingView.cancelAtPeriodEnd) {
    billingView = {
      ...billingView,
      nextSwitch: { interval: session.interval, startsAt: session.startsAt ?? NEW_PERIOD_END },
    }
    return
  }
  const price = PLANS.plans[1]!.prices.find((row) => row.interval === session.interval)!
  const trialEndsAt = billingView.state === 'trialing' ? billingView.trialEndsAt : null
  billingView = {
    ...billingView,
    state: 'active',
    plan: { key: 'paid', name: 'Paid' },
    interval: session.interval,
    price,
    trialEndsAt,
    currentPeriodEnd: trialEndsAt ?? NEW_PERIOD_END,
    cancelAtPeriodEnd: false,
    pastDue: null,
    nextSwitch: null,
    payer: {
      userId: testUser.id,
      name: `${testUser.firstName} ${testUser.lastName}`,
      isMember: true,
    },
    billingEmail: testUser.email,
  }
  entitlementsView = testEntitlements({
    state: 'active',
    trialEndsAt,
    currentPeriodEnd: billingView.currentPeriodEnd,
  })
}

/** Handlers for the billing contract's tenant routes, reading and changing the state above. */
const billingHandlers = [
  // Every tenant reads the same state; unmocked, these 401 and sign the harness user out.
  http.get('/api/v1/plans', () => ok(PLANS, 'Plans retrieved.')),
  http.get('/api/v1/tenants/:slug/entitlements', () =>
    ok(entitlementsView, 'Entitlements retrieved.')
  ),
  http.get('/api/v1/tenants/:slug/billing', () => ok(billingView, 'Billing retrieved.')),
  // The owner's Billing page: no invoices; upgrade requests only under the PII probe.
  http.get('/api/v1/tenants/:slug/billing/invoices', () => ok(listPage([]), 'Invoices retrieved.')),
  http.get('/api/v1/tenants/:slug/upgrade-requests', () =>
    ok(UPGRADE_REQUESTS, 'Upgrade requests retrieved.')
  ),
  http.post('/api/v1/tenants/:slug/upgrade-requests', async ({ request }) => {
    const malformed = await wrongUpgradeRequest(request)
    if (malformed) return malformed
    return ok(
      {
        id: 'upgrade-request-harness',
        createdAt: new Date().toISOString(),
        alreadyRequested: false,
      },
      'Request sent.',
      201
    )
  }),
  http.post('/api/v1/tenants/:slug/banner-dismissals', async ({ request }) => {
    const malformed = await wrongBody(request, { banner: 'trial_ended' })
    if (malformed) return malformed
    billingView = {
      ...billingView,
      dismissedBanners: [...billingView.dismissedBanners, 'trial_ended'],
    }
    return ok(null, 'Banner dismissed.')
  }),
  http.post('/api/v1/tenants/:slug/billing/checkout', async ({ request }) => {
    const interval = await intervalOf(request)
    if (interval === null) {
      return fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
    }
    return ok(checkoutSession('upgrade', interval), 'Checkout started.')
  }),
  http.post('/api/v1/tenants/:slug/billing/interval', async ({ request }) => {
    const interval = await intervalOf(request)
    if (interval === null) {
      return fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
    }
    return ok(checkoutSession('switch', interval), 'Switch started.')
  }),
  http.post('/api/v1/tenants/:slug/billing/payment-method', () =>
    ok(checkoutSession('card_change', billingView.interval ?? 'month'), 'Card change started.')
  ),
  http.post('/api/v1/tenants/:slug/billing/checkout/confirm', async ({ request }) => {
    const body = (await request.json()) as { razorpay_subscription_id?: unknown }
    const session = pendingCheckout
    if (session === null || body.razorpay_subscription_id !== session.subscriptionId) {
      return fail(
        'This payment doesn’t match the checkout we started. Try again.',
        400,
        'CHECKOUT_MISMATCH'
      )
    }
    pendingCheckout = null
    applyCheckout(session)
    return ok(billingView, 'Checkout confirmed.')
  }),
  http.post('/api/v1/tenants/:slug/billing/cancel', () => {
    if (billingView.state === 'past_due') {
      moveToFree()
    } else if (
      billingView.trialEndsAt !== null &&
      Date.parse(billingView.trialEndsAt) > Date.now()
    ) {
      // Before the first charge, the workspace goes back to its trial, as express's endCancelled leaves it.
      billingView = {
        ...billingView,
        state: 'trialing',
        interval: null,
        price: null,
        payer: null,
        currentPeriodEnd: null,
        nextSwitch: null,
      }
      entitlementsView = { ...entitlementsView, state: 'trialing', currentPeriodEnd: null }
    } else {
      billingView = { ...billingView, cancelAtPeriodEnd: true, nextSwitch: null }
      entitlementsView = { ...entitlementsView, cancelAtPeriodEnd: true }
    }
    return ok(billingView, 'Paid cancelled.')
  }),
]

/** The Checkout options that are callbacks, which the fake leaves out of what it records. */
const CALLBACKS = new Set(['handler', 'modal'])

/**
 * `?razorpay=fake` installs a `window.Razorpay` in place of Razorpay's
 * script: `open()` records its options on `window.razorpayFakeOpened` and
 * hands the handler a fixed payment for the session's subscription at once,
 * as a successful Checkout does. Without it, Checkout loads Razorpay's real
 * script.
 */
if (params.get('razorpay') === 'fake') {
  const opened: Record<string, unknown>[] = []
  Object.assign(window, { razorpayFakeOpened: opened })
  window.Razorpay = class FakeRazorpay {
    readonly #options: RazorpayOptions

    constructor(options: RazorpayOptions) {
      this.#options = options
    }

    /** The fake never fails a payment, so its listeners never run. */
    on(): void {}

    /** Records the options and completes the payment. */
    open(): void {
      opened.push(
        Object.fromEntries(
          Object.entries(this.#options).filter(([option]) => !CALLBACKS.has(option))
        )
      )
      queueMicrotask(() => {
        this.#options.handler({
          razorpay_payment_id: 'pay_harness',
          razorpay_subscription_id: this.#options.subscription_id,
          razorpay_signature: 'harness-signature',
        })
      })
    }
  }
}

const worker = setupWorker(
  ...sectionHandlers,
  ...passkeyHandlers,
  // The signed-in layout reads the page's flags on every route; unmocked, they 401 and sign the harness user out.
  ...flagHandlers,
  http.get(
    '/api/v1/tenants',
    () =>
      setupRefusal() ??
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
    ok(null, 'If we can invite that address, we sent it an invitation.')
  ),
  http.post('/api/v1/invitations/preview', () =>
    inviteMode === 'dead' || inviteMode === 'joined'
      ? fail(INVITATION_INVALID, 404, 'invitation_invalid')
      : ok(
          inviteMode === 'ok'
            ? { ...INVITATION_PREVIEW, email: testUser.email }
            : INVITATION_PREVIEW,
          'Invitation retrieved.'
        )
  ),
  http.post('/api/v1/invitations/verify', () => {
    if (inviteMode === 'dead' || inviteMode === 'joined') {
      return fail(INVITATION_INVALID, 404, 'invitation_invalid')
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
      ? fail(INVITATION_INVALID, 404, 'invitation_invalid')
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
      return fail('This link expired or was already used. Ask for a new link.', 400, 'LINK_INVALID')
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
  // Acme's settings; any other tenant's are the defaults in UTC, which the billing banner dates by.
  http.get('/api/v1/tenants/:slug/settings', ({ params }) =>
    ok(
      params.slug === 'acme'
        ? SETTINGS
        : {
            ...SETTINGS,
            tenantId: `harness-${String(params.slug)}`,
            timezone: 'UTC',
            metadata: null,
          },
      'Settings retrieved.'
    )
  ),
  ...billingHandlers,
  // The Insights tab's counts, keyed by :slug; unmocked, this 401s and signs the harness user out.
  http.get('/api/v1/tenants/:slug/insights', () =>
    ok({ membersJoinedLast30Days: 4, invitationsSentLast30Days: 7 }, 'Insights retrieved.')
  ),
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
      : fail("You're signed out. Sign in to continue.", 401)
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
