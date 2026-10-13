import { createFileRoute, redirect } from '@tanstack/react-router'

/** The Account group's root opens Profile, keeping the query and hash. */
export const Route = createFileRoute('/_app/settings/account/')({
  beforeLoad: () => {
    throw redirect({
      to: '/settings/account/profile',
      search: true,
      hash: true,
      replace: true,
    })
  },
})
