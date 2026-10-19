import { createFileRoute, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'

/**
 * A retired password path. Mailed links and bookmarks to /reset-password land on
 * sign-in with a note that sign-in uses email links. The redirect keeps no
 * search, so a mailed `?token=` or `?email=` goes no further.
 */
export const Route = createFileRoute('/reset-password')({
  beforeLoad: () => {
    throw redirect({ to: ROUTES.login, search: { notice: 'sign-in-link' }, replace: true })
  },
})
