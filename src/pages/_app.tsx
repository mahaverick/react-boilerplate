import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/**
 * The signed-in shell. Its loader warms the flags of the page the shell is
 * entered on: the tenant's on a tenant page (a parent route's params include
 * `$slug`), the user's elsewhere. It does not run again on a navigation that
 * stays in the shell, a move to another tenant included: the tenant route's
 * own loader (`/_app/tenants/$slug`) reads that tenant's flags for a
 * navigation that commits, never for a hover preload. `ensureFlags` never
 * rejects, so a failed read renders the page with fallbacks.
 *
 * While maintenance is `full` the guard does not redirect: a page loaded then
 * restores the token but not the profile, which the API refuses, and the
 * maintenance screen covers the route anyway. The guard runs again when the
 * mode ends (`MaintenanceGate`'s recovery), so the user stays on this URL.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    if (useMaintenanceModeStore.getState().mode === 'full') return
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
  },
  loader: ({ context, params }) =>
    ensureFlags(context.queryClient, flagScopeFor(params as { slug?: string })),
  component: AppLayout,
})
