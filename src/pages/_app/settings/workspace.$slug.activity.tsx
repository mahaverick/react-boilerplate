import { createFileRoute } from '@tanstack/react-router'
import { TenantActivityPanel } from '@/components/features/tenant/tenant-activity-panel'
import { pageTitle } from '@/constants/app'

/** Settings › Workspace › Activity: the tenant's audit log, for owners and admins. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/activity')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Activity · ${params.slug}`) }] }),
  staticData: { crumb: 'Activity' },
  component: WorkspaceActivity,
})

/** The activity panel, which already says when the log is for owners and admins only. */
function WorkspaceActivity() {
  const { slug } = Route.useParams()
  return <TenantActivityPanel slug={slug} />
}
