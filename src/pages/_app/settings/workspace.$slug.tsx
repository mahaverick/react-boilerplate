import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router'
import { startTenantRoute } from '@/components/features/tenant/start-tenant-route'
import { TenantGate } from '@/components/features/tenant/tenant-gate'
import { PageSkeleton } from '@/components/shared/page-skeleton'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { stripTenant } from '@/lib/current-tenant'

/**
 * The workspace settings' layout: the tenant from `$slug`, loaded and gated
 * as `/tenants/$slug` is, so flags (`flagScopeFor(params)`), the tenant
 * switcher and analytics grouping resolve this tenant unchanged.
 */
export const Route = createFileRoute('/_app/settings/workspace/$slug')({
  // Its tenant is the path, so a link here never carries `?tenant`.
  search: { middlewares: [stripTenant] },
  preloadStaleTime: 0,
  loader: {
    staleReloadMode: 'blocking',
    handler: ({ context, params, preload }) =>
      startTenantRoute({ queryClient: context.queryClient, slug: params.slug, preload }),
  },
  staticData: { crumb: (params) => params.slug ?? 'Tenant', crumbLink: false },
  component: WorkspaceSettingsLayout,
  pendingComponent: SettingsPagePending,
})

/**
 * The gate, whose panels title themselves `h2` under the settings layout's
 * `h1`, then a line naming the tenant, then the page. Billing has no billing
 * banner: the page shows the same state, and a second checkout beside its own
 * could run at the same time.
 */
function WorkspaceSettingsLayout() {
  const { slug } = Route.useParams()
  const onBilling =
    useMatch({ from: '/_app/settings/workspace/$slug/billing', shouldThrow: false }) !== undefined
  return (
    <TenantGate
      slug={slug}
      heading="h2"
      billingBanner={!onBilling}
      skeleton={<PageSkeleton variant="settings" nested />}
    >
      {(tenant) => (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{tenant.name}</span> · /{tenant.slug}
          </p>
          <Outlet />
        </div>
      )}
    </TenantGate>
  )
}
