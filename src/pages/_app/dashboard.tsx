import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  staticData: { crumb: 'Dashboard' },
  component: DashboardPage,
})

function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const name = user?.firstName ?? user?.email ?? 'there'
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Welcome back, {name}</h1>
        </CardTitle>
        <CardDescription>
          This page is intentionally empty. Derived projects fill it.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
