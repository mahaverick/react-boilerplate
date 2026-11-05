/**
 * @file The session refresh every app shares: one in-flight attempt, the
 * refresh and profile reads, the identity check, and sign-out on an auth
 * verdict. A browser presents its refresh token as a cookie; a native app
 * presents it in the body and keeps it in a store of its own.
 */
import { isAxiosError, type AxiosInstance } from 'axios'
import {
  isAuthVerdict,
  NoRefreshTokenError,
  SessionIdentityChangedError,
} from '@/http/auth-verdict'
import { unwrap } from '@/http/create-api-client'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/** Where the body transport keeps the refresh token between refreshes. */
export interface RefreshTokenStore {
  read(): Promise<string | null>
  write(token: string): Promise<void>
  clear(): Promise<void>
}

/** What `createRefreshCore` is built from. */
export interface RefreshCoreOptions {
  /** The client both requests go through. */
  client: AxiosInstance
  /** `cookie` sends no body; `body` posts the stored token and stores the rotated one. */
  transport: 'cookie' | 'body'
  /** Required for `body`. */
  tokenStore?: RefreshTokenStore
  /** Runs each refresh, so refreshes in different tabs or processes queue. */
  lock?: <T>(run: () => Promise<T>) => Promise<T>
  /** Runs before the store signs out, when the refresh returned a different user. */
  onIdentityChanged?: () => void
  /** Runs after the store signs out on any other verdict, only if a user was signed in. */
  onSignedOut?: () => void
}

/** The refresh core: the shared entry point and its reset. */
export interface RefreshCore {
  ensureSession(): Promise<string>
  reset(): void
}

/** The axios codes of a request that timed out, and so may have reached the API. */
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT'])

/** What `POST /auth/refresh` returns; the body transport also gets the rotated token. */
interface RefreshResponse {
  accessToken: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
}

/**
 * Builds the refresh core.
 * @param options - The client, the transport and the hooks (`RefreshCoreOptions`).
 * @returns `ensureSession`, which every caller shares, and `reset`.
 * @throws When `transport` is `body` and no `tokenStore` is given.
 */
export function createRefreshCore(options: RefreshCoreOptions): RefreshCore {
  const { client, transport, tokenStore, lock, onIdentityChanged, onSignedOut } = options
  if (transport === 'body' && !tokenStore) {
    throw new Error('The body transport needs a tokenStore.')
  }

  /**
   * The single in-flight refresh. Every caller awaits this same promise,
   * because POST /auth/refresh rotates the refresh token and a second call
   * presents the rotated one. The API answers that with a sibling token within
   * its 10s reuse grace window, and revokes the whole session after it.
   */
  let inFlight: Promise<string> | null = null

  /**
   * Posts the refresh. The body transport retries once at once, with the same
   * token, only when no response came back and the request did not time out:
   * such a post most likely never reached the API. A timed-out post may have
   * reached it and rotated the token, and a same-token retry 30s later is past
   * the API's 10s reuse grace window, so it would revoke the session.
   */
  async function postRefresh(refreshToken: string | null): Promise<RefreshResponse> {
    /** One POST /auth/refresh; skipAuthRetry, as re-entering ensureSession() from the interceptor would await this very promise. */
    const post = () =>
      client.post<ApiSuccess<RefreshResponse>>(
        '/auth/refresh',
        refreshToken === null ? undefined : { refreshToken },
        { skipAuthRetry: true }
      )
    if (transport === 'cookie') return unwrap(await post())
    try {
      return unwrap(await post())
    } catch (error) {
      if (!isAxiosError(error) || error.response || TIMEOUT_CODES.has(error.code ?? '')) throw error
      return unwrap(await post())
    }
  }

  /**
   * Refreshes the access token and loads the profile into the store: the
   * refresh returns no user, so the user comes from /profile. Only an auth
   * verdict (`isAuthVerdict`) signs the store out; any other failure rejects
   * with the store untouched, so the next attempt can succeed.
   */
  async function refreshSession(): Promise<string> {
    try {
      let refreshToken: string | null = null
      if (tokenStore) {
        refreshToken = await tokenStore.read()
        if (refreshToken === null) throw new NoRefreshTokenError()
      }

      const refreshed = await postRefresh(refreshToken)
      if (tokenStore) {
        // Not a verdict: the stored token may still be good, so the store is kept and nobody is signed out.
        if (typeof refreshed.refreshToken !== 'string') {
          throw new Error('The refresh response carried no refresh token.')
        }
        await tokenStore.write(refreshed.refreshToken)
      }

      const profileResponse = await client.get<ApiSuccess<User>>('/profile', {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
        skipAuthRetry: true,
      })
      const profile = unwrap(profileResponse)
      const current = useAuthStore.getState().user
      // The catch below signs this tab out without onSignedOut; callers redirect on this verdict rather than carry on as them.
      if (current && current.id !== profile.id) throw new SessionIdentityChangedError()

      useAuthStore.getState().login(refreshed.accessToken, profile)
      return refreshed.accessToken
    } catch (error) {
      if (isAuthVerdict(error)) {
        // Read before logout(): a never-signed-in tab must not announce a sign-out and end a sibling's fresh session.
        const wasAuthed = useAuthStore.getState().isAuthenticated
        const identityChanged = error instanceof SessionIdentityChangedError
        // Before logout(): its analytics reset must stay local, the shared identity is now the other person's.
        if (identityChanged) onIdentityChanged?.()
        useAuthStore.getState().logout()
        // A failed clear must not replace the verdict the callers act on.
        if (tokenStore) await tokenStore.clear().catch(() => {})
        if (wasAuthed && !identityChanged) onSignedOut?.()
      }
      throw error
    }
  }

  return {
    ensureSession() {
      inFlight ??= (lock ? lock(refreshSession) : refreshSession()).finally(() => {
        inFlight = null
      })
      return inFlight
    },
    reset() {
      inFlight = null
    },
  }
}
