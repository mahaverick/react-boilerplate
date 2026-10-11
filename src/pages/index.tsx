import { createFileRoute, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/** The root URL, which only redirects: a signed-in reader to the dashboard, anyone else to sign-in. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: useAuthStore.getState().isAuthenticated ? ROUTES.dashboard : ROUTES.login,
    })
  },
})
