import { http, HttpResponse } from 'msw'
import type { User } from '@/types/api.types'

export const testUser: User = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
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
]
