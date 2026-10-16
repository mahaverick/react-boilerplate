import { createFileRoute } from '@tanstack/react-router'
import { SecuritySection } from '@/components/features/profile/security-section'
import { SettingsRouteError } from '@/components/features/route-error'
import { SettingsPagePending } from '@/components/shared/page-skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'

/** Settings › Security: password, sign-in methods and other sessions. */
export const Route = createFileRoute('/_app/settings/account/security')({
  head: () => ({ meta: [{ title: pageTitle('Security') }] }),
  staticData: { crumb: 'Security' },
  component: SecurityPage,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component'], ['pendingComponent']],
  errorComponent: SettingsRouteError,
})

/** The security section in a card. */
function SecurityPage() {
  return (
    <Card>
      <CardContent>
        <SecuritySection />
      </CardContent>
    </Card>
  )
}
