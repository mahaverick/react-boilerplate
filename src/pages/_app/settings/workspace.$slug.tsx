import { createFileRoute, Outlet } from '@tanstack/react-router'
import { loadTenantRoute } from '@/components/features/tenant/load-tenant-route'
import { TenantGate, TenantLoadFailed } from '@/components/features/tenant/tenant-gate'

/**
 * The workspace settings' layout: the tenant from `$slug`, loaded and gated
 * exactly as `/tenants/$slug` is, so flags (`flagScopeFor(params)`), the tenant
 * switcher and analytics grouping resolve this tenant unchanged.
 */
export const Route = createFileRoute('/_app/settings/workspace/$slug')({
  preloadStaleTime: 0,
  loader: {
    staleReloadMode: 'blocking',
    handler: ({ context, params, preload }) =>
      loadTenantRoute({ queryClient: context.queryClient, slug: params.slug, preload }),
  },
  staticData: { crumb: (params) => params.slug ?? 'Tenant', crumbLink: false },
  component: WorkspaceSettingsLayout,
  errorComponent: TenantLoadFailed,
})

/**
 * The gate, whose panels title themselves `h2` under the settings layout's
 * `h1`, then a line naming the tenant, then the page.
 */
function WorkspaceSettingsLayout() {
  const { slug } = Route.useParams()
  return (
    <TenantGate slug={slug} heading="h2">
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
