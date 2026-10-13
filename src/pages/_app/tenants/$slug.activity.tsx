import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Activity tab; it lives in Settings › Workspace now. */
export const Route = createFileRoute('/_app/tenants/$slug/activity')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/settings/workspace/$slug/activity',
      params,
      search: true,
      hash: true,
      replace: true,
    })
  },
})
