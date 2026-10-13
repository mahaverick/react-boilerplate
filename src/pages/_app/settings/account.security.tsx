import { createFileRoute } from '@tanstack/react-router'
import { SecuritySection } from '@/components/features/profile/security-section'
import { Card, CardContent } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'

/** Settings › Security: password, sign-in methods and other sessions. */
export const Route = createFileRoute('/_app/settings/account/security')({
  head: () => ({ meta: [{ title: pageTitle('Security') }] }),
  staticData: { crumb: 'Security' },
  component: SecurityPage,
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
