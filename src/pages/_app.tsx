import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'

/**
 * The signed-in shell. Its loader warms the page's flags: the tenant's on a
 * tenant page (a parent route's params include `$slug`), the user's
 * elsewhere. `ensureFlags` never rejects, so a failed read renders the page
 * with fallbacks.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
  },
  loader: ({ context, params }) =>
    ensureFlags(context.queryClient, flagScopeFor(params as { slug?: string })),
  component: AppLayout,
})
