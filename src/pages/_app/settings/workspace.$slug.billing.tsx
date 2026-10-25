import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'

/** Settings › Workspace › Billing: the plan, the card and invoices. A placeholder until the billing page lands. */
export const Route = createFileRoute('/_app/settings/workspace/$slug/billing')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Billing · ${params.slug}`) }] }),
  staticData: { crumb: 'Billing' },
  component: WorkspaceBilling,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** The placeholder body: the billing page replaces it. */
function WorkspaceBilling() {
  return <p className="text-sm text-muted-foreground">Billing opens here.</p>
}
