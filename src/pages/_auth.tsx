import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/**
 * The signed-out pages. A signed-in user is sent to the dashboard, except
 * while maintenance is `full`, when the maintenance screen covers the page and
 * the URL is kept until the mode ends and the guard runs again.
 */
export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    if (useMaintenanceModeStore.getState().mode === 'full') return
    // __root's beforeLoad has awaited bootstrapSession(), so the store is settled.
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.dashboard })
    }
  },
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
})
