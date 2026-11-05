/**
 * @file The auth verdict: which failures judge the caller's credentials and
 * may end a session. Shared by every app; nothing here touches a platform.
 */
import { isAxiosError } from 'axios'

/**
 * The refresh handed back a different person than this tab was signed in as:
 * another tab signed someone else in on the shared refresh credential. It is an
 * auth verdict (`isAuthVerdict`): this tab signs out, and nothing it started
 * is replayed as the new person. It is not broadcast: the credential is the
 * other tab's valid session.
 */
export class SessionIdentityChangedError extends Error {
  constructor() {
    super('The refreshed session belongs to a different user.')
    this.name = 'SessionIdentityChangedError'
  }
}

/**
 * The body transport has no refresh token to present, so there is no session
 * to restore. It is an auth verdict, raised before any request is sent.
 */
export class NoRefreshTokenError extends Error {
  constructor() {
    super('There is no stored session to restore.')
    this.name = 'NoRefreshTokenError'
  }
}

/**
 * Whether a failed refresh was the server judging the credentials: a 401, the
 * refresh returning a different user (`SessionIdentityChangedError`), or no
 * refresh token to present (`NoRefreshTokenError`), and nothing else. It is
 * the only refresh failure that may end a session (other requests:
 * interceptors.ts).
 *
 * The API's refresh answers 401 when the token is missing, when rotation
 * rejects it (unknown, reused outside the grace window, expired, or past the
 * session's absolute lifetime), and when the account is gone or inactive.
 * Every other failure judges nobody, and treating it as a verdict signs out a
 * user whose session is good:
 *
 * - **5xx**: nginx answers 502/503 through a rolling restart, and any tab that
 *   refreshes during a deploy (a page load, an expired token) goes through
 *   `ensureSession()`, so it would sign out.
 * - **429**: `/auth/refresh` is rate limited, and every tab's interceptor and
 *   bootstrap share that limit.
 * - **A malformed 200**: `rejectMalformedJsonResponse` throws an `AxiosError`
 *   that carries a response.
 * - **No response**: a network error, DNS failure, axios timeout or abort.
 * - **A non-Axios throw**, such as a bug in the refresh code.
 *
 * Widen it only with a status the API's refresh produces as a judgment on the
 * caller's credentials.
 */
export function isAuthVerdict(error: unknown): boolean {
  if (error instanceof SessionIdentityChangedError) return true
  if (error instanceof NoRefreshTokenError) return true
  return isAxiosError(error) && error.response?.status === 401
}
