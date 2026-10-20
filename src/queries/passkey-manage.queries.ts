import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FRONTEND_APP } from '@/constants/frontend-app'
import { apiClient, unwrap } from '@/http/client'
import {
  createPasskeyCredential,
  signalAcceptedPasskeys,
  signalPasskeyUser,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@/lib/webauthn'
import {
  passkeyKeys,
  passkeySupportQueryOptions,
  usePasskeyConfig,
} from '@/queries/passkey.queries'
import { passkeyNameSchema } from '@/schemas/passkey.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess } from '@/types/api.types'
import type { PasskeyChallenge, PasskeyList, PublicPasskey } from '@/types/passkey.types'

/**
 * Managing passkeys lives apart from `passkey.queries.ts`, which the sign-in
 * page loads: this file is part of Settings › Security's lazy chunk.
 */

/**
 * Whether this browser can create passkeys, once known. Shares the cache entry
 * of `usePasskeySupport` (one options factory), so the package loads once. `known` is false until the
 * answer arrives, so the page does not flash "can't create" first.
 */
export function usePasskeyCreateSupport(): { known: boolean; create: boolean } {
  const { data } = useQuery(passkeySupportQueryOptions())
  return { known: data !== undefined, create: data?.create ?? false }
}

/**
 * Creates a passkey: asks for options (`POST /auth/passkeys/registration/options`),
 * has the browser create the credential, then verifies it
 * (`POST /auth/passkeys/registration/verify`). A refused step-up answers the
 * options call, so the page runs the whole mutation through `useStepUp().run`.
 * On success the passkey joins the cached list and the browser learns the
 * account's name and email for it (`signalPasskeyUser`).
 */
export function useCreatePasskey() {
  const queryClient = useQueryClient()
  const { data: config } = usePasskeyConfig()
  return useMutation({
    mutationFn: async () => {
      const { challengeId, options } = unwrap(
        await apiClient.post<ApiSuccess<PasskeyChallenge<PublicKeyCredentialCreationOptionsJSON>>>(
          '/auth/passkeys/registration/options',
          { app: FRONTEND_APP }
        )
      )
      const response = await createPasskeyCredential(options)
      return unwrap(
        await apiClient.post<ApiSuccess<{ passkey: PublicPasskey }>>(
          '/auth/passkeys/registration/verify',
          { challengeId, response, app: FRONTEND_APP }
        )
      )
    },
    onSuccess: ({ passkey }) => {
      const user = useAuthStore.getState().user
      if (config && user) signalPasskeyUser(config.rpId, user)
      const cached = queryClient.getQueryData<PasskeyList>(passkeyKeys.list)
      if (cached) {
        queryClient.setQueryData<PasskeyList>(passkeyKeys.list, {
          ...cached,
          passkeys: [...cached.passkeys, passkey],
        })
      } else {
        void queryClient.invalidateQueries({ queryKey: passkeyKeys.list })
      }
    },
  })
}

/**
 * Renames a passkey (`PATCH /auth/passkeys/:id`). The name is trimmed and
 * checked first, so trimming reaches the wire. The cached row is replaced, and
 * the browser is told the account's details again.
 */
export function useRenamePasskey() {
  const queryClient = useQueryClient()
  const { data: config } = usePasskeyConfig()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      unwrap(
        await apiClient.patch<ApiSuccess<{ passkey: PublicPasskey }>>(`/auth/passkeys/${id}`, {
          name: passkeyNameSchema.parse(name),
        })
      ),
    onSuccess: ({ passkey }) => {
      const user = useAuthStore.getState().user
      if (config && user) signalPasskeyUser(config.rpId, user)
      queryClient.setQueryData<PasskeyList>(passkeyKeys.list, (cached) =>
        cached
          ? { ...cached, passkeys: cached.passkeys.map((p) => (p.id === passkey.id ? passkey : p)) }
          : cached
      )
    },
  })
}

/**
 * Deletes a passkey (`DELETE /auth/passkeys/:id?app=web`). The answer is the
 * passkeys that remain: they replace the cached list, and the browser is told
 * which credentials the account still accepts. The page runs it through
 * `useStepUp().run`.
 */
export function useDeletePasskey() {
  const queryClient = useQueryClient()
  const { data: config } = usePasskeyConfig()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await apiClient.delete<ApiSuccess<PasskeyList>>(`/auth/passkeys/${id}`, {
          params: { app: FRONTEND_APP },
        })
      ),
    onSuccess: (list) => {
      queryClient.setQueryData<PasskeyList>(passkeyKeys.list, list)
      if (config) signalAcceptedPasskeys(config.rpId, list.userHandle, list.passkeys)
    },
  })
}
