import { createFileRoute, useParams } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { TenantActivityPanel } from '@/components/features/tenant/tenant-activity-panel'
import { pageTitle } from '@/constants/app'

/** Settings › Workspace › Activity: the tenant's audit log, for owners and admins. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/activity')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Activity · ${params.slug}`) }] }),
  staticData: { crumb: 'Activity' },
  component: WorkspaceActivity,
  /** Kept out of a lazy chunk, as the router's default error screen is: a failed fetch could not load it. */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** The activity panel, which already says when the log is for owners and admins only. */
function WorkspaceActivity() {
  // Not `Route.useParams()`: a lazy page chunk importing `Route` back from the entry makes Rolldown split the error listener out of it (pnpm check:bundle).
  const { slug } = useParams({ from: '/_app/settings/workspace/$slug/activity' })
  return <TenantActivityPanel slug={slug} />
}
