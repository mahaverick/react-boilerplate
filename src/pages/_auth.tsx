import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { ROUTES } from '@/constants/routes'
import { isSignedInVisitor } from '@/lib/signed-in-guard'

/**
 * The signed-out pages. A signed-in user is sent to the dashboard, except
 * while maintenance is `full`, when the maintenance screen covers the page and
 * the URL is kept until the mode ends and the guard runs again.
 */
export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    if (isSignedInVisitor()) throw redirect({ to: ROUTES.dashboard })
  },
  pendingComponent: AuthPagePending,
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
})
