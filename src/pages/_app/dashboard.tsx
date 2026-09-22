import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/dashboard')({
  staticData: { crumb: 'Dashboard' },
  component: DashboardPage,
})

function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const name = user?.firstName ?? user?.email ?? 'there'
  return (
    <Card>
      <CardHeader>
        {/* CardTitle renders a div, so the page would otherwise have no
            heading at all — axe's `page-has-heading-one` is on by default. */}
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
