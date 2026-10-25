import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { startTenantRoute } from '@/components/features/tenant/start-tenant-route'
import { TenantGate } from '@/components/features/tenant/tenant-gate'
import { PageSkeleton } from '@/components/shared/page-skeleton'
import { DetailPending } from '@/components/shared/pending-templates'
import { Badge } from '@/components/ui/badge'
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { stripTenant } from '@/lib/current-tenant'
import { cn } from '@/lib/utils'
import { useFlagValues } from '@/observability/flags/flag-hooks'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-types'
import { filterByFlag } from '@/observability/flags/flag-values'
import { useMyRole } from '@/queries/tenant.queries'

/**
 * The tenant shell: header, tab bar, `<Outlet />`. A layout route whose tabs
 * are real child routes, so each is linkable and survives a reload.
 *
 * The loader (`startTenantRoute`) starts the detail read for every tab and
 * waits only for the tenant's flags, at most `FLAGS_BOOT_WAIT_MS`, so a
 * switch from another tenant, which the `_app` loader does not run for, paints
 * this tenant's flag-driven UI (the Beta tab) on first load. A hover preload
 * starts only the detail read. `preloadStaleTime: 0` and a blocking stale
 * reload make a commit after a hover preload run the loader again, so its
 * flags are read before the page renders; both reads are cache-aware, so
 * neither is fetched twice. The gate shows the `detail` template until the
 * tenant lands, then the not-found, suspended or load-error panel, or the
 * page: `tenantQueryOptions` resolves a 404 to `null`, and the tenant list
 * tells a suspended tenant from a missing one. Analytics groups the page from
 * the loader's tenant read (`installRouteAnalytics`). The crumb is the slug,
 * not the name, because static data resolves before any fetch.
 */
export const Route = createFileRoute('/_app/tenants/$slug')({
  // Its tenant is the path, so a link here never carries `?tenant`.
  search: { middlewares: [stripTenant] },
  preloadStaleTime: 0,
  loader: {
    staleReloadMode: 'blocking',
    handler: ({ context, params, preload }) =>
      startTenantRoute({ queryClient: context.queryClient, slug: params.slug, preload }),
  },
  head: ({ params }) => ({ meta: [{ title: pageTitle(params.slug) }] }),
  staticData: { crumb: (params) => params.slug ?? 'Tenant' },
  component: TenantLayout,
  pendingComponent: DetailPending,
})

/** One tenant tab. `flag` hides it while that tenant-scoped flag is off for this tenant. */
interface TenantTab {
  to: '/tenants/$slug' | '/tenants/$slug/beta' | '/tenants/$slug/insights'
  label: string
  exact: boolean
  flag?: BooleanClientFlagKey
}

const TABS: readonly TenantTab[] = [
  { to: '/tenants/$slug', label: 'Overview', exact: true },
  { to: '/tenants/$slug/insights', label: 'Insights', exact: false },
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
    <TenantGate slug={slug} skeleton={<PageSkeleton variant="detail" />}>
      {(tenant) => (
        <div className="grid gap-4">
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
