import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FRONTEND_APP } from '@/constants/frontend-app'
import { apiClient, unwrap } from '@/http/client'
import { broadcastAuthMessage, switchIdentity } from '@/http/session'
import { codeFrom } from '@/lib/api-error'
import {
  passkeyCancelGeneration,
  passkeySupport,
  requestPasskey,
  signalUnknownPasskey,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@/lib/webauthn'
import { track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess } from '@/types/api.types'
import {
  PASSKEY_UNKNOWN,
  type PasskeyChallenge,
  type PasskeyConfig,
  type PasskeyList,
  type PasskeySignIn,
} from '@/types/passkey.types'

/** The keys of the passkey reads, under a `passkeys` prefix of their own. */
export const passkeyKeys = {
  config: ['passkeys', 'config'],
  list: ['passkeys', 'list'],
  support: ['passkeys', 'support'],
} as const

/** What the app assumes when the config cannot be read: passkeys are off. */
const PASSKEYS_OFF: PasskeyConfig = { mode: 'off', rpId: '' }

/**
 * Query options for `GET /auth/passkeys/config`. The request is public: no
 * bearer, no refresh retry. A 404 (the route is absent), a network failure or
 * any other error resolves to `{ mode: 'off', rpId: '' }`, so a page that waits
 * on the config never fails with it and passkeys are never offered by mistake.
 */
export function passkeyConfigQueryOptions() {
  return queryOptions({
    queryKey: passkeyKeys.config,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<PasskeyConfig> => {
      try {
        return unwrap(
          await apiClient.get<ApiSuccess<PasskeyConfig>>('/auth/passkeys/config', {
            signal,
            skipAuthRetry: true,
            headers: { Authorization: false },
          })
        )
      } catch {
        return PASSKEYS_OFF
      }
    },
  })
}

/** The passkey config: the mode and the relying-party id. Never rejects. */
export function usePasskeyConfig() {
  return useQuery(passkeyConfigQueryOptions())
}

/**
 * The caller's passkeys, oldest first, with the WebAuthn user handle.
 * @param enabled - False until the config says passkeys are on.
 */
export function usePasskeys(enabled: boolean) {
  return useQuery({
    queryKey: passkeyKeys.list,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await apiClient.get<ApiSuccess<PasskeyList>>('/auth/passkeys', { signal })),
  })
}

/**
 * What this browser can do with passkeys (`passkeySupport`), read once and
 * shared by every caller. Both are false until the answer arrives, and while
 * `enabled` is false nothing loads the WebAuthn package.
 * @param enabled - False while passkeys are off, so the check never runs.
 */
export function usePasskeySupport(enabled: boolean): { create: boolean; autofill: boolean } {
  const { data } = useQuery({
    queryKey: passkeyKeys.support,
    enabled,
    staleTime: Infinity,
    queryFn: passkeySupport,
  })
  return data ?? { create: false, autofill: false }
}

/**
 * Signs in by passkey: asks for options (`POST /auth/passkeys/sign-in/options`),
 * prompts, then verifies (`POST /auth/passkeys/sign-in/verify`). Both calls are
 * public, so neither sends the bearer or retries through a refresh, like
 * `useVerifySignInLink`. `modal` opens the browser's sheet; `autofill` waits
 * behind the email field's `webauthn` token.
 *
 * A prompt cancelled while the options were loading never opens. On success it
 * makes the session the new identity, as the link sign-in does. A
 * `PASSKEY_UNKNOWN` signals the credential to the browser first, so it stops
 * offering it; `PASSKEY_NO_ACCESS` sends no signal, because that passkey is
 * valid and a signal could delete it.
 */
export function usePasskeySignIn() {
  const queryClient = useQueryClient()
  const { data: config } = usePasskeyConfig()
  return useMutation({
    mutationFn: async (mode: 'modal' | 'autofill') => {
      const since = passkeyCancelGeneration()
      const { challengeId, options } = unwrap(
        await apiClient.post<ApiSuccess<PasskeyChallenge<PublicKeyCredentialRequestOptionsJSON>>>(
          '/auth/passkeys/sign-in/options',
          {},
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      )
      const response = await requestPasskey(options, mode, since)
      try {
        return unwrap(
          await apiClient.post<ApiSuccess<PasskeySignIn>>(
            '/auth/passkeys/sign-in/verify',
            { challengeId, response, app: FRONTEND_APP },
            { skipAuthRetry: true, headers: { Authorization: false } }
          )
        )
      } catch (error) {
        if (codeFrom(error) === PASSKEY_UNKNOWN && config) {
          signalUnknownPasskey(config.rpId, response.id)
        }
        throw error
      }
    },
    onSuccess: ({ accessToken, user }) => {
      switchIdentity(queryClient, user.id)
      useAuthStore.getState().login(accessToken, user)
      track('sign_in_completed', { method: 'passkey' })
      broadcastAuthMessage('signed_in')
    },
  })
}
