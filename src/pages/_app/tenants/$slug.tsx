import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABELS } from '@/constants/roles'
import { cn } from '@/lib/utils'
import { tenantQueryOptions, useMyRole, useTenant } from '@/queries/tenant.queries'

/**
 * The tenant shell: header, tab bar, `<Outlet />`.
 *
 * A LAYOUT route, not a leaf. The three tabs are real child routes
 * (`$slug.index.tsx`, `$slug.members.tsx`, `$slug.settings.tsx`), so each one
 * is linkable, bookmarkable and survives a reload — which a `<Tabs>` widget
 * holding its own panel state would not.
 */
export const Route = createFileRoute('/_app/tenants/$slug')({
  // Warms the cache once for all three tabs. `tenantQueryOptions` resolves a
  // 404 to `null` rather than rejecting, so this never throws and a tenant
  // that does not exist — or that this user is not a member of — reaches the
  // not-found panel below instead of the router's error boundary.
  loader: async ({ context, params }) =>
    context.queryClient.ensureQueryData(tenantQueryOptions(params.slug)),
  // The slug, not the tenant's name: static data is resolved before any
  // fetch, and a crumb that arrived a beat after the page would move the
  // header under the reader.
  staticData: { crumb: (params) => params.slug ?? 'Tenant' },
  component: TenantLayout,
})

const TABS = [
  { to: '/tenants/$slug', label: 'Overview', exact: true },
  { to: '/tenants/$slug/members', label: 'Members', exact: false },
  { to: '/tenants/$slug/settings', label: 'Settings', exact: false },
] as const

/**
 * The tab bar.
 *
 * A `nav` of real links rather than a Base UI `Tabs`: these tabs are routes.
 * A tab widget would own the panel state, and reloading on the Members tab
 * would put the reader back on Overview.
 */
function TenantTabs({ slug }: { slug: string }) {
  return (
    <nav aria-label="Tenant sections" className="border-b">
      <ul className="flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
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
 * What a 404 looks like.
 *
 * `GET /tenants/:slug` answers the SAME 404 for "no such tenant" and "you are
 * not a member" (Ruling G), and this copy deliberately does not guess between
 * them: saying "you are not a member of acme" to someone who is not would
 * confirm that acme exists.
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

function TenantLayout() {
  const { slug } = Route.useParams()
  const tenant = useTenant(slug)
  const { role } = useMyRole(slug)

  if (tenant.isPending) {
    return (
      <div className="grid max-w-4xl gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  // `null` is the not-found VALUE the query resolves a 404 to — not an error,
  // and not an empty cache.
  if (!tenant.data) return <TenantNotFound slug={slug} />

  return (
    <div className="grid max-w-4xl gap-4">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{tenant.data.name}</h1>
          {role && <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">/{tenant.data.slug}</p>
      </header>
      <TenantTabs slug={slug} />
      <Outlet />
    </div>
  )
}
