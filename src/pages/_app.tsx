import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
  },
  component: AppLayout,
})
