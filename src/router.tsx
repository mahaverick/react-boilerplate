import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { ensureSession } from '@/http/session'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

/**
 * Restore the session once per page load.
 *
 * The access token is memory-only, so every reload starts signed out.
 * Without this, `_app` would bounce a signed-in user to /login and
 * `_auth` would let them sit on /login while their cookie was still good.
 *
 * ensureSession() already dedupes concurrent callers and already calls
 * logout() on failure, so this only has to flip isBootstrapped.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  try {
    await ensureSession()
  } catch {
    /* no valid refresh cookie: staying signed out is the correct outcome */
  } finally {
    useAuthStore.getState().setBootstrapped()
  }
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
