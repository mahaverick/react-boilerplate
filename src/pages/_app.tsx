import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { retainTenant, tenantSearchSchema } from '@/lib/current-tenant'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/**
 * The signed-in shell. Its loader warms the flags of the page the shell is
 * entered on (`ensureFlags`, which waits at most `FLAGS_BOOT_WAIT_MS`): the
 * tenant's on a tenant page (a parent route's params include `$slug`), the
 * user's elsewhere. It does not run again on a navigation that stays in the
 * shell, a move to another tenant included: the tenant route's own loader
 * (`/_app/tenants/$slug`) reads that tenant's flags for a navigation that
 * commits, never for a hover preload. `ensureFlags` never rejects, so a failed
 * or slow read renders the page with fallbacks.
 *
 * While maintenance is `full` the guard does not redirect, so the user keeps
 * the page they had instead of landing on /login. The API lets the refresh
 * and profile reads through in `full`, so a page with no user here is the rare
 * case, such as an unreachable API. The maintenance screen covers the route
 * meanwhile, and the guard runs again when the mode ends (`MaintenanceGate`'s
 * recovery).
 *
 * The shell also owns `?tenant`, the current tenant on a page without
 * `$slug` (`src/lib/current-tenant.ts`): `validateSearch` accepts only a
 * slug, `retainTenant` keeps the tenant on every navigation inside the shell,
 * and `TenantSearchGuard`, in the layout, fills or corrects it after mount.
 */
export const Route = createFileRoute('/_app')({
  validateSearch: tenantSearchSchema,
  search: { middlewares: [retainTenant] },
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
