import { createFileRoute, Link } from '@tanstack/react-router'
import { GettingStartedCard } from '@/components/features/tenant/getting-started-card'
import { TenantDetails } from '@/components/features/tenant/tenant-overview-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { useMyRole, useTenant } from '@/queries/tenant.queries'

/** The tenant's Overview tab, its default child route. */
export const Route = createFileRoute('/_app/tenants/$slug/')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Overview · ${params.slug}`) }] }),
  staticData: { crumb: 'Overview' },
  component: TenantOverviewTab,
})

/**
 * The overview tab: the Getting started checklist, then the tenant's details,
 * read-only, with a link to edit them in Settings › Workspace. With no tenant
 * data the layout has already rendered its not-found panel.
 */
function TenantOverviewTab() {
  const { slug } = Route.useParams()
  const tenant = useTenant(slug)
  const { role, access } = useMyRole(slug)
  if (!tenant.data) return null
  return (
    <div className="grid gap-4">
      {role && access && <GettingStartedCard slug={slug} role={role} access={access} />}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Details</h2>
          </CardTitle>
          <CardDescription>
            <Link
              to="/settings/workspace/$slug/general"
              params={{ slug }}
              className="underline underline-offset-4"
            >
              Workspace settings
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TenantDetails tenant={tenant.data} />
        </CardContent>
      </Card>
    </div>
  )
}
