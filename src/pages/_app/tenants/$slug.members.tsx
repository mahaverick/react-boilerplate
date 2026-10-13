import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Members tab; it lives in Settings › Workspace now. */
export const Route = createFileRoute('/_app/tenants/$slug/members')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/settings/workspace/$slug/members', params, replace: true })
  },
})
