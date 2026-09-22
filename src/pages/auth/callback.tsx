import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoaderCircleIcon } from 'lucide-react'
import { useEffect } from 'react'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

// Outside `_auth` on purpose: this route has no guard. A guard would bounce
// the freshly signed-in visitor before this component ever ran.
export const Route = createFileRoute('/auth/callback')({
  component: OAuthCallbackPage,
})

function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // No /auth/refresh call here: `__root`'s beforeLoad already awaited
    // bootstrapSession(), which consumed the cookie the backend just set.
    // Reading the store is therefore reading a settled result.
    const { isAuthenticated } = useAuthStore.getState()
    void navigate(
      isAuthenticated
        ? { to: ROUTES.dashboard }
        : { to: ROUTES.login, search: { error: 'google_auth_failed' } }
    )
  }, [navigate])

  return (
    <div role="status" className="flex min-h-svh items-center justify-center gap-3">
      {/* aria-hidden on the icon and a visible-to-screen-readers label:
          Base UI emits no accessible name of its own here. */}
      <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Completing sign-in…</span>
    </div>
  )
}
