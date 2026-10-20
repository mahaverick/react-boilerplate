/**
 * @file The app's side of required mode: the response interceptor that turns
 * a 403 `PASSKEY_SETUP_REQUIRED` into the setup flag, and the step that ends
 * the setup. It reaches no component and no WebAuthn code: the router imports
 * it on the first visit.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import type { AxiosInstance } from 'axios'
import { messageFrom } from '@/lib/api-error'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import { isPasskeySetupRequired } from '@/types/passkey.types'

/**
 * Raises the setup flag on every 403 `PASSKEY_SETUP_REQUIRED` that `client`
 * receives, and drops it when the signed-in user is replaced. The refusal still
 * rejects with its own error. A sign-out or a switch to another user resets the
 * flag; a sign-in (no user before) does not, since the request that raised it
 * may have run first. Returns the cleanup.
 * @param client - The axios instance every API call goes through.
 */
export function installPasskeySetupInterceptor(client: AxiosInstance): () => void {
  const id = client.interceptors.response.use(undefined, (error: unknown) => {
    if (isPasskeySetupRequired(error)) {
      usePasskeySetupStore.getState().setRequired(true, messageFrom(error))
    }
    throw error
  })
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (previous.user && previous.user.id !== state.user?.id) {
      usePasskeySetupStore.getState().setRequired(false)
    }
  })
  return () => {
    client.interceptors.response.eject(id)
    unsubscribe()
  }
}

/**
 * Ends the setup: clears the flag, then re-runs the route guards and loaders and
 * refetches every query, so the page the user was on renders without a reload.
 * @param router - The app's router.
 * @param queryClient - The client holding the page's queries.
 */
export async function finishPasskeySetup(
  router: AnyRouter,
  queryClient: QueryClient
): Promise<void> {
  usePasskeySetupStore.getState().setRequired(false)
  await router.invalidate()
  await queryClient.invalidateQueries()
}
