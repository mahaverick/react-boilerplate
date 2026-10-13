import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old profile page; it lives in Settings now, so bookmarks land there. */
export const Route = createFileRoute('/_app/profile')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/account/profile', replace: true })
  },
})
