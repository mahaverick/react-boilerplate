import { createFileRoute } from '@tanstack/react-router'
import { TenantSettingsCard } from '@/components/features/tenant/tenant-settings-card'
import { pageTitle } from '@/constants/app'

/** The Settings tab: timezone, locale and metadata, editable by owners and admins. */
export const Route = createFileRoute('/_app/tenants/$slug/settings')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Settings · ${params.slug}`) }] }),
  staticData: { crumb: 'Settings' },
  component: TenantSettingsTab,
})

/** Renders the settings card for the route's tenant. */
function TenantSettingsTab() {
  const { slug } = Route.useParams()
  return <TenantSettingsCard slug={slug} />
}
