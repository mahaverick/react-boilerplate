import { createFileRoute, useParams } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { TenantActivityPanel } from '@/components/features/tenant/tenant-activity-panel'
import { SettingsPagePending } from '@/components/shared/page-skeleton'
import { pageTitle } from '@/constants/app'

/** Settings › Workspace › Activity: the tenant's audit log, for owners and admins. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/activity')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Activity · ${params.slug}`) }] }),
  staticData: { crumb: 'Activity' },
  component: WorkspaceActivity,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component'], ['pendingComponent']],
  errorComponent: SettingsRouteError,
})

/** The activity panel, which already says when the log is for owners and admins only. */
function WorkspaceActivity() {
  // Not `Route.useParams()`: this route module imports the error screen (route-error, then observability/errors), and a page chunk importing `Route` back from it makes Rolldown split the error listener out of the entry chunk (pnpm check:bundle).
  const { slug } = useParams({ from: '/_app/settings/workspace/$slug/activity' })
  return <TenantActivityPanel slug={slug} />
}
