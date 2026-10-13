import { createFileRoute, useParams } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { ReadOnlyBanner } from '@/components/features/settings/read-only-banner'
import { TenantMembersPanel } from '@/components/features/tenant/tenant-members-panel'
import { pageTitle } from '@/constants/app'
import { canManageTenant } from '@/constants/roles'
import { useMyRole } from '@/queries/tenant.queries'

/** Settings › Workspace › Members: the member list with role, remove and leave actions, and pending invitations. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/members')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Members · ${params.slug}`) }] }),
  staticData: { crumb: 'Members' },
  component: WorkspaceMembers,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** The read-only banner for non-managers, then the members panel. */
function WorkspaceMembers() {
  // Not `Route.useParams()`: this route module imports the error screen (route-error, then observability/errors), and a page chunk importing `Route` back from it makes Rolldown split the error listener out of the entry chunk (pnpm check:bundle).
  const { slug } = useParams({ from: '/_app/settings/workspace/$slug/members' })
  const { role } = useMyRole(slug)
  return (
    <div className="grid gap-4">
      {role && !canManageTenant(role) && <ReadOnlyBanner />}
      <TenantMembersPanel slug={slug} />
    </div>
  )
}
