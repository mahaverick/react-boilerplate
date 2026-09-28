import { HttpResponse } from 'msw'
import { fail } from '@/tests/mocks/handlers'

/**
 * Every way `POST /auth/refresh` can fail WITHOUT judging the caller's
 * credentials. None of these may end a session — see `isAuthVerdict`
 * (`src/http/session.ts`), which is 401 and nothing else.
 *
 * ONE table, deliberately, imported by BOTH sides of that rule:
 * `session.test.ts` asserts none of these clears the store, and
 * `interceptors.test.ts` asserts none of them redirects to /login. A session
 * left intact by `session.ts` but bounced to the login page from the
 * interceptor is signed out just the same, only through a different door, so
 * the two halves have to stay in step.
 *
 * It lives here rather than in either test file so a new status is pinned
 * on both sides at once: two separate literals would let a status added to
 * only one file leave the other half unpinned, with a green suite either
 * way. Add a case here and both sides gain a test.
 *
 * Why each entry is not a verdict:
 * - **502 / 503**: nginx through a rolling restart or a dead upstream. The
 *   SSE stream errors, the hook reconnects through `ensureSession()`, and a
 *   logout here would sign out every user with a tab open on every deploy.
 * - **429**: `/auth/refresh` is rate limited (`auth.routes.ts`), and
 *   `useNotificationStream` retries on a schedule across every open tab — so
 *   our own retry policy can manufacture the 429 that would end the session.
 * - **A 200 carrying HTML**: `rejectMalformedJsonResponse`
 *   (`src/http/interceptors.ts`) throws an `AxiosError` that CARRIES a
 *   response, so a poisoned cache entry or a misrouted proxy response would
 *   look exactly like an auth verdict to any predicate that only checks
 *   `response !== undefined`.
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
