import { createFileRoute } from '@tanstack/react-router'
import { DashboardPending } from '@/components/shared/page-skeleton'
import { Pii } from '@/components/shared/pii'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { useAuthStore } from '@/states/auth.store'

/** The signed-in landing page, an empty placeholder for derived projects to fill. */
export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  staticData: { crumb: 'Dashboard' },
  component: DashboardPage,
  pendingComponent: DashboardPending,
})

/** Greets the signed-in user by first name, else by email. */
function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const name = user?.firstName ?? user?.email ?? 'there'
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>
            Welcome back, <Pii>{name}</Pii>
          </h1>
        </CardTitle>
        <CardDescription>
          This page is intentionally empty. Derived projects fill it.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
