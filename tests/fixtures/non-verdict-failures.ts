import { HttpResponse } from 'msw'
import { fail } from '@/tests/mocks/handlers'

/**
 * Every way `POST /auth/refresh` can fail without judging the caller's credentials. None of
 * these may end a session: `isAuthVerdict` (`src/http/session.ts`) treats a 401 response, or
 * a refresh that returns a different user (`SessionIdentityChangedError`), as a verdict, and
 * nothing else.
 *
 * One table, imported by both sides of that rule: `session.test.ts` asserts none of these
 * clears the store, and `interceptors.test.ts` asserts none of them redirects to /login. A
 * session that `session.ts` leaves intact but the interceptor bounces to the login page is
 * signed out just the same, so the halves must stay in step. A status added here is pinned
 * on both sides at once; two separate literals would leave the other half unpinned.
 *
 * Why each entry is not a verdict:
 * - **502 / 503**: nginx through a rolling restart or a dead upstream. The SSE stream
 *   errors and the hook reconnects through `ensureSession()`, so a logout here would sign
 *   out every user with a tab open on every deploy.
 * - **429**: `/auth/refresh` is rate limited (`auth.routes.ts`), and `useNotificationStream`
 *   retries on a schedule across every open tab, so our own retry policy can manufacture
 *   the 429 that would end the session.
 * - **A 200 carrying HTML**: `rejectMalformedJsonResponse` (`src/http/interceptors.ts`)
 *   throws an `AxiosError` that carries a response, so a poisoned cache entry or a
 *   misrouted proxy response would look like an auth verdict to a predicate that only
 *   checks `response !== undefined`.
 */
export const NON_VERDICT_FAILURES: [string, () => Response][] = [
  ['a 502 from an upstream gateway mid-deploy', () => fail('Bad Gateway', 502)],
  ['a 503 from a restarting upstream', () => fail('Service Unavailable', 503)],
  ['a 429 from the refresh rate limiter', () => fail('Too Many Requests', 429)],
  [
    'a malformed 200 carrying HTML',
    () =>
      new HttpResponse('<!doctype html><title>nope</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  ],
]
