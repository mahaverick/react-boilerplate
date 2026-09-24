import { http, HttpResponse } from 'msw'
import type { InvitationPreview, TenantInvitation, User } from '@/types/api.types'

export const testUser: User = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** 43 characters of base64url, the shape the server mints and validates. */
export const TEST_INVITATION_TOKEN = 'inv-token-'.padEnd(43, 'x')

/** One pending row, as `GET /tenants/:slug/invitations` lists it. */
export const testInvitation: TenantInvitation = {
  id: 'inv-1',
  email: 'invitee@b.com',
  role: 'editor',
  invitedBy: { id: 'u1', firstName: 'A', lastName: 'B' },
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

export function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return HttpResponse.json({ success: true, message, statusCode, data }, { status: statusCode })
}

export function fail(message: string, statusCode: number, code?: string) {
  return HttpResponse.json(
    { success: false, message, statusCode, code, requestId: 'test-request-id' },
    { status: statusCode }
  )
}

export const handlers = [
  http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // Express answers every registration this way, free address or taken: no user, ever.
  http.post('/api/v1/auth/register', () =>
    ok(null, 'If that address can be registered, a verification email has been sent.', 202)
  ),
  // The notification bell lives in the app shell's header, so EVERY test that
  // mounts an authenticated route hits these two — and `onUnhandledRequest:
  // 'error'` would fail each one otherwise. Empty defaults: a test that cares
  // about notification content overrides them with `server.use(...)`.
  //
  // `notifications`, not `items`, and `nextCursor` absent rather than null —
  // the same shape NotificationRepository.list actually returns.
  http.get('/api/v1/notifications', () => ok({ notifications: [] }, 'Notifications retrieved.')),
  http.get('/api/v1/notifications/preferences', () =>
    ok({ preferences: [] }, 'Notification preferences retrieved.')
  ),
  // `useNotificationStream` reads this over `fetch`, not `EventSource` — so
  // it is real traffic as far as msw is concerned, and `AppLayout` opens it
  // on every authenticated render, same reason as the two defaults above.
  // A body that never enqueues and never closes is the fetch-transport
  // equivalent of the idle `EventSource` stub this replaced: `response.ok`
  // resolves, the hook's `for await` parks on a read that never settles, and
  // nothing here ever needs to look like a real notification. A test that
  // DOES care about the stream's frames overrides `fetch` itself with
  // `stubStreamFetch` (`tests/mocks/fetch-stream.ts`), which bypasses this
  // handler entirely.
  http.get(
    '/api/v1/notifications/stream',
    () =>
      new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })
  ),
  // The tenant switcher lives in the app shell's sidebar, so every test that
  // mounts an authenticated route hits this one too — same reason as the two
  // notification defaults above. An empty list: a test about tenants
  // overrides it with `server.use(...)`.
  //
  // `[{ tenant, role }]`, not bare tenants — `TenantRepository.listForUser`
  // selects the tenant row and the caller's membership role side by side.
  http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
  // Pending invitations, empty like the list above. A test about them
  // overrides it with `server.use(...)`.
  http.get('/api/v1/tenants/:slug/invitations', () => ok([], 'Invitations retrieved.')),
  // Invite answers 202 with `data: null` whether or not the address has an
  // account, the same way register does.
  http.post('/api/v1/tenants/:slug/invitations', () =>
    ok(null, 'If that address can be invited, an invitation has been sent.', 202)
  ),
  http.post('/api/v1/tenants/:slug/invitations/:id/resend', () =>
    ok(null, 'Invitation resent.', 202)
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
]
