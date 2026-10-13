import { createFileRoute } from '@tanstack/react-router'
import { TenantMembersPanel } from '@/components/features/tenant/tenant-members-panel'
import { pageTitle } from '@/constants/app'

/** The Members tab: the tenant's member list with role, remove and leave actions, and its pending invitations. */
export const Route = createFileRoute('/_app/tenants/$slug/members')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Members · ${params.slug}`) }] }),
  staticData: { crumb: 'Members' },
  component: TenantMembersTab,
})

/** Renders the members panel for the route's tenant. */
function TenantMembersTab() {
  const { slug } = Route.useParams()
  return <TenantMembersPanel slug={slug} />
}
