import { createFileRoute } from '@tanstack/react-router'
import { TenantActivityPanel } from '@/components/features/tenant/tenant-activity-panel'
import { pageTitle } from '@/constants/app'

/** The Activity tab, which lists a tenant's audit log for owners and admins. */
export const Route = createFileRoute('/_app/tenants/$slug/activity')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Activity · ${params.slug}`) }] }),
  staticData: { crumb: 'Activity' },
  component: TenantActivityTab,
})

/** Renders the activity panel for the route's tenant. */
function TenantActivityTab() {
  const { slug } = Route.useParams()
  return <TenantActivityPanel slug={slug} />
}
