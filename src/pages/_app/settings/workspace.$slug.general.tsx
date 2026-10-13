import { createFileRoute, useParams } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { ReadOnlyBanner } from '@/components/features/settings/read-only-banner'
import { TenantOverviewCard } from '@/components/features/tenant/tenant-overview-card'
import { TenantSettingsCard } from '@/components/features/tenant/tenant-settings-card'
import { pageTitle } from '@/constants/app'
import { canManageTenant } from '@/constants/roles'
import { useMyRole } from '@/queries/tenant.queries'

/** Settings › Workspace › General: the tenant's details, timezone and locale. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/general')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`General · ${params.slug}`) }] }),
  staticData: { crumb: 'General' },
  component: WorkspaceGeneral,
  /** Kept out of a lazy chunk, as the router's default error screen is: a failed fetch could not load it. */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** The read-only banner for non-managers, then the details and settings cards. */
function WorkspaceGeneral() {
  // Not `Route.useParams()`: a lazy page chunk importing `Route` back from the entry makes Rolldown split the error listener out of it (pnpm check:bundle).
  const { slug } = useParams({ from: '/_app/settings/workspace/$slug/general' })
  const { role } = useMyRole(slug)
  return (
    <div className="grid gap-4">
      {role && !canManageTenant(role) && <ReadOnlyBanner />}
      <TenantOverviewCard slug={slug} />
      <TenantSettingsCard slug={slug} />
    </div>
  )
}
