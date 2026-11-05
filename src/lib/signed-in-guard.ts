import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/**
 * Whether a signed-out page's guard should send this visitor on: signed in,
 * except while maintenance is `full`, when the maintenance screen covers the
 * page and the URL is kept until the mode ends and the guard runs again. Both
 * `_auth` and `/delete-account` ask it, so a signed-in visitor is never shown a
 * sign-in form on either.
 */
export function isSignedInVisitor(): boolean {
  if (useMaintenanceModeStore.getState().mode === 'full') return false
  // __root's beforeLoad has awaited bootstrapSession(), so the store is settled.
  return useAuthStore.getState().isAuthenticated
}
