import { useMutation } from '@tanstack/react-query'
import { FRONTEND_APP } from '@/constants/frontend-app'
import { apiClient, unwrap } from '@/http/client'
import { broadcastAuthMessage, ensureSession, isAuthVerdict } from '@/http/session'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { useAuthStore } from '@/states/auth.store'
import { ACCESS_TOKEN_EXPIRED, type ApiSuccess } from '@/types/api.types'

/** Posts a step-up link's token with the current bearer, refusing the interceptor's refresh-and-retry. */
async function postStepUpLink(token: string) {
  return unwrap(
    await apiClient.post<ApiSuccess<{ accessToken: string }>>(
      '/auth/step-up/link/verify',
      { token },
      { skipAuthRetry: true }
    )
  )
}

/**
 * Confirms it's the signed-in person with the token from an emailed "Confirm
 * it's you" link (express `POST /auth/step-up/link/verify`). It carries this
 * session's bearer, because the API binds the link to the session that asked
 * for it.
 *
 * An expired access token (401 `ACCESS_TOKEN_EXPIRED`) is refreshed once
 * through `ensureSession()` and the token posted again; the refresh keeps the
 * session id, so the binding still holds. The interceptor's own retry is
 * skipped because its verdict path calls `redirectToLogin()`, which would
 * carry the token into `/login?redirect=`. A refresh verdict rejects with the
 * original 401, which the page reads as the session's end; any other refresh
 * failure rejects with that failure, which leaves the link usable.
 *
 * On success it swaps in the new access token, whose `auth_time` is now, and
 * tells the waiting tab, which refreshes and retries its action.
 */
export function useConfirmStepUpLink() {
  return useMutation({
    mutationFn: async (token: string) => {
      try {
        return await postStepUpLink(token)
      } catch (error) {
        if (statusFrom(error) !== 401 || codeFrom(error) !== ACCESS_TOKEN_EXPIRED) throw error
        try {
          await ensureSession()
        } catch (refreshError) {
          throw isAuthVerdict(refreshError) ? error : refreshError
        }
        return postStepUpLink(token)
      }
    },
    onSuccess: ({ accessToken }) => {
      useAuthStore.getState().setToken(accessToken)
      broadcastAuthMessage('step_up_confirmed')
    },
  })
}

/**
 * Mails a "Confirm it's you" link for this session (express
 * `POST /auth/step-up/link/request`, which takes `{ app }`). It answers 202
 * with when the next request may mail again; inside that wait, a 429
 * `STEP_UP_LINK_COOLDOWN` with `Retry-After`.
 */
export function useRequestStepUpLink() {
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.post<ApiSuccess<{ resendAvailableAt: string }>>(
          '/auth/step-up/link/request',
          { app: FRONTEND_APP }
        )
      ),
  })
}
