import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoaderCircleIcon } from 'lucide-react'
import { useEffect } from 'react'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where the API's Google callback lands. Outside `_auth`, with no guard, which
 * would bounce the freshly signed-in visitor before this ran. It makes no
 * refresh call: `__root`'s beforeLoad already awaited bootstrapSession(),
 * which used the cookie the API just set, so the store is settled.
 */
export const Route = createFileRoute('/auth/callback')({
  head: () => ({ meta: [{ title: pageTitle('Signing in') }] }),
  component: OAuthCallbackPage,
})

function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const { isAuthenticated } = useAuthStore.getState()
    void navigate(
      isAuthenticated
        ? { to: ROUTES.dashboard }
        : { to: ROUTES.login, search: { error: 'google_auth_failed' } }
    )
  }, [navigate])

  return (
    <div role="status" className="flex min-h-svh items-center justify-center gap-3">
      <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Completing sign-in…</span>
    </div>
  )
}
