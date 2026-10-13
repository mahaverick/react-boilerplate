import { createFileRoute, redirect } from '@tanstack/react-router'

/** The workspace root opens General. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/settings/workspace/$slug/general', params, replace: true })
  },
})
