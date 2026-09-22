import { createFileRoute, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: useAuthStore.getState().isAuthenticated ? ROUTES.dashboard : ROUTES.login,
    })
  },
})
