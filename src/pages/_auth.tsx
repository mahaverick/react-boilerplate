import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    // __root's beforeLoad has already awaited bootstrapSession(), so the
    // store is settled by the time this runs.
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
