import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { ApiSuccess } from '@/types/api.types'
import type { PasskeyConfig, PasskeyList } from '@/types/passkey.types'

/** The keys of the passkey reads, under a `passkeys` prefix of their own. */
export const passkeyKeys = {
  config: ['passkeys', 'config'],
  list: ['passkeys', 'list'],
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
