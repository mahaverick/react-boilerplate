import { createFileRoute, Outlet } from '@tanstack/react-router'
import {
  loadTenantRoute,
  TenantGate,
  TenantLoadFailed,
} from '@/components/features/tenant/tenant-gate'

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
  staticData: { crumb: (params) => params.slug ?? 'Tenant' },
  component: WorkspaceSettingsLayout,
  errorComponent: TenantLoadFailed,
})

/** The gate, a line naming the tenant, then the page. */
function WorkspaceSettingsLayout() {
  const { slug } = Route.useParams()
  return (
    <TenantGate slug={slug}>
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
