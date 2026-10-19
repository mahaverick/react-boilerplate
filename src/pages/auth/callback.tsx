import '@/lib/zod-jitless'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Spinner } from '@/components/ui/spinner'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { safeRedirect } from '@/lib/safe-redirect'
import { track } from '@/observability/telemetry'
import { tenantsQueryOptions } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where the API's Google callback lands, with the stored `redirect` and
 * `new=1` for an account this sign-in created. The router JSON-parses a
 * search value that starts with a digit, so `new=1` arrives as the number 1;
 * the string is accepted too, and anything else is dropped.
 *
 * It sits outside `_auth`, whose guard would bounce the freshly signed-in
 * visitor before this ran. It makes no refresh call: `__root`'s beforeLoad
 * already awaited bootstrapSession(), which used the cookie the API just set,
 * so the store is settled.
 */
export const Route = createFileRoute('/auth/callback')({
  validateSearch: z.object({
    redirect: z.string().optional().catch(undefined),
    // A custom check, not a union of literals, which would add Zod's literal class to the shared chunk.
    new: z
      .custom<1 | '1'>((value) => value === 1 || value === '1')
      .optional()
      .catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Signing in') }] }),
  component: OAuthCallbackPage,
  pendingComponent: AuthPagePending,
})

/**
 * Lands a signed-in visitor: a new account on /welcome, anyone else on the
 * safe redirect, or else the dashboard, unless they belong to no tenant, who
 * go to /welcome too. A failed tenant read lands on the dashboard, whose own
 * prompt covers that case. A signed-out visitor goes to sign-in with the
 * Google failure code. Every landing replaces this page in history. The ref
 * keeps StrictMode's second effect run from tracking the sign-in twice.
 */
function OAuthCallbackPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { redirect, new: isNewUser } = Route.useSearch()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    if (!useAuthStore.getState().isAuthenticated) {
      void navigate({ to: ROUTES.login, search: { error: 'google_auth_failed' }, replace: true })
      return
    }
    track('sign_in_completed', { method: 'google' })
    if (isNewUser !== undefined) {
      void navigate({ to: ROUTES.welcome, replace: true })
      return
    }
    const target = safeRedirect(redirect)
    if (target) {
      void navigate({ href: target, replace: true })
      return
    }
    void queryClient.fetchQuery(tenantsQueryOptions()).then(
      (tenants) =>
        navigate({ to: tenants.length === 0 ? ROUTES.welcome : ROUTES.dashboard, replace: true }),
      () => navigate({ to: ROUTES.dashboard, replace: true })
    )
  }, [isNewUser, navigate, queryClient, redirect])

  return (
    <AuthLayout>
      <AuthCard title="Signing in">
        <div
          role="status"
          className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden="true" />
          <span>Completing sign-in…</span>
        </div>
      </AuthCard>
    </AuthLayout>
  )
}
