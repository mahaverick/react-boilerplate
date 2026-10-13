import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Settings tab; it lives in Settings › Workspace now. */
export const Route = createFileRoute('/_app/tenants/$slug/settings')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/settings/workspace/$slug/general', params, replace: true })
  },
})
