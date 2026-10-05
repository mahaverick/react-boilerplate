import { http, HttpResponse } from 'msw'
import type { MembershipRole } from '@/constants/roles'
import type { ClientFlagValues } from '@/observability/flags/flag-types'
import { INVITATION_ID, USER_ID } from '@/tests/fixtures/ids'
import type {
  InvitationPreview,
  OnboardingStepView,
  TenantAccess,
  TenantInvitation,
  TenantOnboarding,
  User,
} from '@/types/api.types'

export const testUser: User = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null,
  analyticsOptOut: false,
}

/** 43 characters of base64url, the shape the server mints and validates. */
export const TEST_INVITATION_TOKEN = 'inv-token-'.padEnd(43, 'x')

/** express's one answer to an invite and to a resend, whether or not the address has an account. */
export const INVITATION_SENT_MESSAGE =
  'If that address can be invited, an invitation has been sent.'

/** One pending row, as `GET /tenants/:slug/invitations` lists it. */
export const testInvitation: TenantInvitation = {
  id: INVITATION_ID,
  email: 'invitee@b.com',
  role: 'editor',
  invitedBy: { id: USER_ID, firstName: 'A', lastName: 'B' },
  expiresAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z',
}

/** Sent to `testUser`'s own address, so a signed-in test user is the invitee. */
export const testInvitationPreview: InvitationPreview = {
  tenant: { name: 'Acme Corp', slug: 'acme' },
  role: 'editor',
  invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
  email: testUser.email,
}

/** The four default registry steps express serves, in its order, none done. */
export const TEST_ONBOARDING_STEPS: readonly OnboardingStepView[] = [
  {
    key: 'configure_settings',
    title: 'Configure your settings',
    description: 'Set the timezone and locale your team works in.',
    scope: 'tenant',
    kind: 'auto',
    required: true,
    completedAt: null,
    source: null,
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
]

/**
 * `GET /tenants/:slug/onboarding` for a tenant created after onboarding
 * tracking began: in progress, nothing done. `overrides.steps` replaces the
 * list; `doneKeys` marks those default steps done instead.
 */
export function testOnboarding(
  overrides: Partial<TenantOnboarding> = {},
  doneKeys: readonly string[] = []
): TenantOnboarding {
  const steps = TEST_ONBOARDING_STEPS.map((step) =>
    doneKeys.includes(step.key)
      ? { ...step, completedAt: '2026-09-30T09:00:00.000Z', source: 'auto' as const }
      : step
  )
  return {
    state: 'in_progress',
    steps,
    requiredDone: steps.filter((step) => step.required && step.completedAt !== null).length,
    requiredTotal: steps.filter((step) => step.required).length,
    completedAt: null,
    dismissedAt: null,
    ...overrides,
  }
}

/**
 * Every react flag at its fallback, written out rather than read from the
 * flags module: this file loads in the setup file, before a test's
 * `vi.mock('@/observability/flags/flag-keys', …)` could apply, and importing
 * the module here would pin the real slice for every test.
 */
export const TEST_FLAG_FALLBACKS = {
  example_beta_page: false,
  example_cta_experiment: 'control',
} satisfies ClientFlagValues

/**
 * A flags read as express answers it: every flag at its fallback unless
 * `overrides` says otherwise.
 */
export function testFlags(
  overrides: Partial<Record<keyof ClientFlagValues, boolean | string>> = {}
) {
  return {
    flags: { ...TEST_FLAG_FALLBACKS, ...overrides },
    evaluatedAt: '2026-10-05T09:00:00.000Z',
  }
}

export function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return HttpResponse.json({ success: true, message, statusCode, data }, { status: statusCode })
}

export function fail(message: string, statusCode: number, code?: string) {
  return HttpResponse.json(
    { success: false, message, statusCode, code, requestId: 'test-request-id' },
    { status: statusCode }
  )
}

/**
 * `GET /tenants/:slug` as the API answers it: the tenant row plus the
 * caller's EFFECTIVE role there and how they reached it. `useMyRole` reads
 * the role from here, so a detail mock without it renders the role error.
 */
export function tenantDetail<T extends object>(
  tenant: T,
  role: MembershipRole,
  access: TenantAccess = 'member'
) {
  return { ...tenant, isPlatform: false, role, access }
}

export const handlers = [
  http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // The profile's analytics switch; the name form's tests answer PATCH themselves.
  http.patch('/api/v1/profile', async ({ request }) =>
    ok({ ...testUser, ...((await request.json()) as Partial<User>) }, 'Profile updated.')
  ),
  // Express answers every registration this way, free address or taken: no user, ever.
  http.post('/api/v1/auth/register', () =>
    ok(null, 'If that address can be registered, a verification email has been sent.', 202)
  ),
  // The profile page's Security section fetches this whenever /profile mounts. A password account; a test about Google or a failed load overrides it.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [{ provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' }],
        hasPassword: true,
      },
      'Auth providers retrieved.'
    )
  ),
  /**
   * The notification bell lives in the app shell's header, so EVERY test
   * that mounts an authenticated route hits these two — and
   * `onUnhandledRequest: 'error'` would fail each one otherwise. Empty
   * defaults: a test that cares about notification content overrides them
   * with `server.use(...)`.
   *
   * `notifications`, not `items`, and `nextCursor` absent rather than null
   * — the same shape NotificationRepository.list actually returns.
   */
  http.get('/api/v1/notifications', () => ok({ notifications: [] }, 'Notifications retrieved.')),
  http.get('/api/v1/notifications/preferences', () =>
    ok({ preferences: [] }, 'Notification preferences retrieved.')
  ),
  /**
   * `useNotificationStream` reads this over `fetch`, not `EventSource` — so
   * it is real traffic as far as msw is concerned, and `AppLayout` opens it
   * on every authenticated render, same reason as the two defaults above. A
   * body that never enqueues and never closes answers every read with a
   * pending promise: `response.ok` resolves, the hook's `for await` parks
   * on a read that never settles, and nothing here ever needs to look like
   * a real notification. A test that DOES care about the stream's frames
   * overrides `fetch` itself with `stubStreamFetch`
   * (`tests/mocks/fetch-stream.ts`), which bypasses this handler entirely.
   */
  http.get(
    '/api/v1/notifications/stream',
    () =>
      new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })
  ),
  /**
   * The tenant switcher lives in the app shell's sidebar, so every test
   * that mounts an authenticated route hits this one too — same reason as
   * the two notification defaults above. An empty list: a test about
   * tenants overrides it with `server.use(...)`.
   *
   * `[{ tenant, role }]`, not bare tenants — `TenantRepository.listForUser`
   * selects the tenant row and the caller's membership role side by side.
   */
  http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
  // Pending invitations, empty like the list above. A test about them overrides it with `server.use(...)`.
  http.get('/api/v1/tenants/:slug/invitations', () => ok([], 'Invitations retrieved.')),
  // Invite and resend answer 202 with `data: null` whether or not the address has an account, the same way register does.
  http.post('/api/v1/tenants/:slug/invitations', () => ok(null, INVITATION_SENT_MESSAGE, 202)),
  http.post('/api/v1/tenants/:slug/invitations/:id/resend', () =>
    ok(null, INVITATION_SENT_MESSAGE, 202)
  ),
  http.delete('/api/v1/tenants/:slug/invitations/:id', () => ok(null, 'Invitation revoked.')),
  http.post('/api/v1/invitations/preview', () =>
    ok(testInvitationPreview, 'Invitation retrieved.')
  ),
  http.post('/api/v1/invitations/accept', () =>
    ok(
      { tenant: testInvitationPreview.tenant, role: testInvitationPreview.role },
      'Invitation accepted.'
    )
  ),
  // Every tenant overview mounts the Getting started card. In progress, nothing done; a test about another state overrides it.
  http.get('/api/v1/tenants/:slug/onboarding', () => ok(testOnboarding(), 'Onboarding retrieved.')),
  http.post('/api/v1/tenants/:slug/onboarding/steps/:key/complete', () =>
    ok(testOnboarding(), 'Onboarding step completed.')
  ),
  http.post('/api/v1/tenants/:slug/onboarding/dismiss', () =>
    ok(
      testOnboarding({ state: 'dismissed', dismissedAt: '2026-10-01T09:00:00.000Z' }),
      'Onboarding dismissed.'
    )
  ),
  http.post('/api/v1/tenants/:slug/onboarding/undismiss', () =>
    ok(testOnboarding(), 'Onboarding restored.')
  ),
  /**
   * The signed-in layout's loader reads the page's flags on every
   * authenticated route: the user's, or the tenant's on a tenant page. Every
   * flag at its fallback; a test about a flag overrides these. Exposure
   * reports answer 204, as express does.
   */
  http.get('/api/v1/flags', () => ok(testFlags(), 'Flags retrieved.')),
  http.get('/api/v1/tenants/:slug/flags', () => ok(testFlags(), 'Flags retrieved.')),
  http.post('/api/v1/flags/exposures', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/v1/tenants/:slug/flags/exposures', () => new HttpResponse(null, { status: 204 })),
  // Tenant audit log, empty. A test about activity overrides it.
  http.get('/api/v1/tenants/:slug/audit-log', () =>
    ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
  ),
]
