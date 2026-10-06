import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'

/**
 * The signed-in shell. Its loader warms the flags of the page the shell is
 * entered on: the tenant's on a tenant page (a parent route's params include
 * `$slug`), the user's elsewhere. It does not run again on a navigation that
 * stays in the shell, a move to another tenant included: that page's readers
 * fetch its flags and show the fallbacks meanwhile. `ensureFlags` never
 * rejects, so a failed read renders the page with fallbacks.
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
