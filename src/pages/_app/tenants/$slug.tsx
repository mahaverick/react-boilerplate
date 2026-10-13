import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { loadTenantRoute } from '@/components/features/tenant/load-tenant-route'
import { TenantGate, TenantLoadFailed } from '@/components/features/tenant/tenant-gate'
import { Badge } from '@/components/ui/badge'
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { cn } from '@/lib/utils'
import { useFlagValues } from '@/observability/flags/flag-hooks'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-types'
import { filterByFlag } from '@/observability/flags/flag-values'
import { useMyRole } from '@/queries/tenant.queries'

/**
 * The tenant shell: header, tab bar, `<Outlet />`. A layout route whose tabs
 * are real child routes, so each is linkable and survives a reload.
 *
 * The loader (`loadTenantRoute`) warms the detail query for every tab, and the
 * tenant's flags in parallel, so a switch from another tenant, which the `_app`
 * loader does not run for, paints this tenant's flag-driven UI (the Beta tab)
 * on first load. A hover preload reads only the detail. `preloadStaleTime: 0` and a blocking stale reload make that
 * commit run the loader again after a preload, before the page renders; both
 * reads are cache-aware, so the detail is not fetched twice. `ensureFlags`
 * never rejects, so a failed flags read never blocks the page. `tenantQueryOptions`
 * resolves a 404 to `null`, so a tenant with no detail reaches the layout,
 * which reads the tenant list to choose between the suspended panel (a member
 * of a suspended tenant) and the not-found panel; any other failure reaches
 * `errorComponent`. The crumb is the slug, not the name, because static data
 * resolves before any fetch.
 */
export const Route = createFileRoute('/_app/tenants/$slug')({
  preloadStaleTime: 0,
  loader: {
    staleReloadMode: 'blocking',
    handler: ({ context, params, preload }) =>
      loadTenantRoute({ queryClient: context.queryClient, slug: params.slug, preload }),
  },
  head: ({ params }) => ({ meta: [{ title: pageTitle(params.slug) }] }),
  staticData: { crumb: (params) => params.slug ?? 'Tenant' },
  component: TenantLayout,
  errorComponent: TenantLoadFailed,
})

/** One tenant tab. `flag` hides it while that tenant-scoped flag is off for this tenant. */
interface TenantTab {
  to: '/tenants/$slug' | '/tenants/$slug/beta'
  label: string
  exact: boolean
  flag?: BooleanClientFlagKey
}

const TABS: readonly TenantTab[] = [
  { to: '/tenants/$slug', label: 'Overview', exact: true },
  { to: '/tenants/$slug/beta', label: 'Beta', exact: false, flag: 'example_beta_page' },
]

/**
 * The tab bar: a `nav` of real links, since the tabs are routes, not widget
 * panels. A flagged tab is left out while its flag is off.
 */
function TenantTabs({ slug }: { slug: string }) {
  const tabs = filterByFlag(TABS, useFlagValues())
  return (
    <nav aria-label="Tenant sections" className="border-b">
      <ul className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <Link
              to={tab.to}
              params={{ slug }}
              activeOptions={{ exact: tab.exact }}
              className="inline-block border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
              activeProps={{
                className: cn('border-primary font-medium text-foreground'),
                'aria-current': 'page',
              }}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * The tenant shell. The URL's tenant is the active one: analytics groups the
 * page under it from the route's loader data (`installRouteAnalytics`), not
 * from here, so the group is set before the page view.
 */
function TenantLayout() {
  const { slug } = Route.useParams()
  const { role } = useMyRole(slug)
  return (
    <TenantGate slug={slug}>
      {(tenant) => (
        <div className="grid max-w-4xl gap-4 xl:max-w-6xl">
          <header className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold lg:text-3xl">{tenant.name}</h1>
              {role && <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
          </header>
          <TenantTabs slug={slug} />
          <Outlet />
        </div>
      )}
    </TenantGate>
  )
}
