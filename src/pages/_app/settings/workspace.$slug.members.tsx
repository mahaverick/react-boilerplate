import { createFileRoute } from '@tanstack/react-router'
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
})

/** The read-only banner for non-managers, then the members panel. */
function WorkspaceMembers() {
  const { slug } = Route.useParams()
  const { role } = useMyRole(slug)
  return (
    <div className="grid gap-4">
      {role && !canManageTenant(role) && <ReadOnlyBanner />}
      <TenantMembersPanel slug={slug} />
    </div>
  )
}
