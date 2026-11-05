import { createFileRoute } from '@tanstack/react-router'
import { DeleteAccountSection } from '@/components/features/account/delete-account-section'
import { SettingsRouteError } from '@/components/features/route-error'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { Card, CardContent } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'

/** Settings › Delete account: ask for the account to be deleted, or see the open request. */
export const Route = createFileRoute('/_app/settings/account/delete')({
  head: () => ({ meta: [{ title: pageTitle('Delete account') }] }),
  staticData: { crumb: 'Delete account' },
  component: DeleteAccountPage,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** The delete-account section in a card. */
function DeleteAccountPage() {
  return (
    <Card>
      <CardContent>
        <DeleteAccountSection />
      </CardContent>
    </Card>
  )
}
