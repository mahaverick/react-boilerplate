import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { ROUTES } from '@/constants/routes'
import { retainTenant, tenantSearchSchema } from '@/lib/current-tenant'
import { noteError } from '@/observability/errors'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/** The guard's entry point, typed without importing its chunk. */
type TenantGuard = typeof import('@/lib/tenant-guard').tenantSearchCorrection

/**
 * The signed-in shell. Its loader warms the flags of the page the shell is
 * entered on: the tenant's on a tenant page (a parent route's params include
 * `$slug`), the user's elsewhere. It does not run again on a navigation that
 * stays in the shell, a move to another tenant included: the tenant route's
 * own loader (`/_app/tenants/$slug`) reads that tenant's flags for a
 * navigation that commits, never for a hover preload. `ensureFlags` never
 * rejects, so a failed read renders the page with fallbacks.
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
 * and the guard (`src/lib/tenant-guard.ts`), after the auth check, fills or
 * corrects it. The guard is loaded on demand, to keep the tenant queries out
 * of the entry chunk; if its chunk cannot be fetched, the failure is noted and
 * the page renders with the URL as it is. The tenant guard is skipped in
 * `full` maintenance too.
 */
export const Route = createFileRoute('/_app')({
  validateSearch: tenantSearchSchema,
  search: { middlewares: [retainTenant] },
  beforeLoad: async ({ context, location, params, search, preload }) => {
    if (useMaintenanceModeStore.getState().mode === 'full') return
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
    let tenantSearchCorrection: TenantGuard
    try {
      ;({ tenantSearchCorrection } = await import('@/lib/tenant-guard'))
    } catch (error) {
      // A missing guard must not take down the shell; retainTenant still carries the tenant.
      noteError(error, 'chunk_load', true)
      return
    }
    const correction = await tenantSearchCorrection({
      queryClient: context.queryClient,
      location,
      params,
      search,
      preload,
    })
    // An explicit `tenant` key, `undefined` included, so `retainTenant` does not put the old value back.
    if (correction) throw redirect({ to: '.', search: (prev) => ({ ...prev, ...correction }) })
  },
  loader: ({ context, params }) =>
    ensureFlags(context.queryClient, flagScopeFor(params as { slug?: string })),
  component: AppLayout,
})
