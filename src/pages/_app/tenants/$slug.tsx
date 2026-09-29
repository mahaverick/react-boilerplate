import { createFileRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { PlatformAccessBanner } from '@/components/features/platform-access-banner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { canViewActivity, ROLE_LABELS } from '@/constants/roles'
import { cn } from '@/lib/utils'
import { tenantQueryOptions, useMyRole, useTenant, useTenants } from '@/queries/tenant.queries'

/**
 * The tenant shell: header, tab bar, `<Outlet />`. A layout route whose tabs
 * are real child routes, so each is linkable and survives a reload.
 *
 * The loader warms the detail query for every tab. `tenantQueryOptions`
 * resolves a 404 to `null`, so a missing or inaccessible tenant reaches the
 * not-found panel, and any other failure reaches `errorComponent`. The crumb
 * is the slug, not the name, because static data resolves before any fetch.
 */
export const Route = createFileRoute('/_app/tenants/$slug')({
  loader: async ({ context, params }) =>
    context.queryClient.ensureQueryData(tenantQueryOptions(params.slug)),
  head: ({ params }) => ({ meta: [{ title: pageTitle(params.slug) }] }),
  staticData: { crumb: (params) => params.slug ?? 'Tenant' },
  component: TenantLayout,
  errorComponent: TenantLoadFailed,
})

/** Said of the request, not of the tenant: unlike `TenantNotFound`, the tenant may be fine. */
const TENANT_LOAD_ERROR =
  'We could not load this tenant. The request failed, which is not the same as the tenant being gone.'

/**
 * The route's error boundary. Retry is `router.invalidate()`, which re-runs
 * the loader; `ensureQueryData` finds no data and fetches again.
 */
function TenantLoadFailed() {
  const router = useRouter()
  return <LoadError message={TENANT_LOAD_ERROR} onRetry={() => void router.invalidate()} />
}

const TABS = [
  { to: '/tenants/$slug', label: 'Overview', exact: true },
  { to: '/tenants/$slug/members', label: 'Members', exact: false },
  { to: '/tenants/$slug/settings', label: 'Settings', exact: false },
] as const

/** Owner and admin only, the same bar as the audit-log route it reads. */
const ACTIVITY_TAB = { to: '/tenants/$slug/activity', label: 'Activity', exact: false } as const

/** The tab bar: a `nav` of real links, since the tabs are routes, not widget panels. */
function TenantTabs({ slug, showActivity }: { slug: string; showActivity: boolean }) {
  /** Annotated: `.map` over a union of two array types is not callable. */
  const tabs: readonly ((typeof TABS)[number] | typeof ACTIVITY_TAB)[] = showActivity
    ? [...TABS, ACTIVITY_TAB]
    : TABS
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
 * What a 404 looks like. `GET /tenants/:slug` answers the same 404 for "no such
 * tenant" and "no access", and this copy does not guess between them: "you are
 * not a member of acme" would confirm that acme exists.
 */
function TenantNotFound({ slug }: { slug: string }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>Tenant not available</h1>
        </CardTitle>
        <CardDescription>
          We could not open <span className="font-medium">/{slug}</span>. Either it does not exist
          or it is not one of yours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/tenants" className="text-sm underline underline-offset-4">
          Back to your tenants
        </Link>
      </CardContent>
    </Card>
  )
}

/**
 * A tenant the caller belongs to but that staff have suspended. Its own
 * routes answer 404 like a missing tenant, so the tenant list (which still
 * carries it, with its state) is what tells the two apart. Only the caller's
 * own memberships reach this, so it confirms nothing about other tenants.
 */
function TenantSuspended({ name }: { name: string }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>Tenant suspended</h1>
        </CardTitle>
        <CardDescription>
          <span className="font-medium">{name}</span> is unavailable right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm">This tenant is suspended. Contact support.</p>
        <Link to="/tenants" className="text-sm underline underline-offset-4">
          Back to your tenants
        </Link>
      </CardContent>
    </Card>
  )
}

function TenantLayout() {
  const { slug } = Route.useParams()
  const tenant = useTenant(slug)
  const { role } = useMyRole(slug)
  const listed = useTenants().data?.find((entry) => entry.tenant.slug === slug)

  if (tenant.isPending) {
    return (
      <div className="grid max-w-4xl gap-4 xl:max-w-6xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!tenant.data) {
    return listed?.tenant.lifecycleState === 'suspended' ? (
      <TenantSuspended name={listed.tenant.name} />
    ) : (
      <TenantNotFound slug={slug} />
    )
  }

  return (
    <div className="grid max-w-4xl gap-4 xl:max-w-6xl">
      {tenant.data.access === 'platform' && (
        <PlatformAccessBanner tenantName={tenant.data.name} role={tenant.data.role} />
      )}
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold lg:text-3xl">{tenant.data.name}</h1>
          {role && <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">/{tenant.data.slug}</p>
      </header>
      <TenantTabs slug={slug} showActivity={canViewActivity(tenant.data.role)} />
      <Outlet />
    </div>
  )
}
