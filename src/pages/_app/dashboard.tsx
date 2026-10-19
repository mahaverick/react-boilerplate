import { IconBuilding } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { EmptyState } from '@/components/shared/empty-state'
import { DashboardPending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/** The signed-in landing page, an empty placeholder for derived projects to fill. */
export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  staticData: { crumb: 'Dashboard' },
  component: DashboardPage,
  pendingComponent: DashboardPending,
})

/**
 * Greets the signed-in user by first name, else by email. A user who belongs
 * to no workspace also gets the prompt to create one, under the greeting. Only
 * an empty list shows it: a pending or failed read is not a claim that the
 * user has none.
 */
function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const tenants = useTenants()
  const name = user?.firstName ?? user?.email ?? 'there'
  const noWorkspace = tenants.data?.length === 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>
            Welcome back, <Pii>{name}</Pii>
          </h1>
        </CardTitle>
        {!noWorkspace && (
          <CardDescription>
            This page is intentionally empty. Derived projects fill it.
          </CardDescription>
        )}
      </CardHeader>
      {noWorkspace && (
        <CardContent>
          <EmptyState
            icon={<IconBuilding aria-hidden="true" />}
            title="Create your workspace"
            description="You don’t belong to a workspace yet."
            action={
              <Link to={ROUTES.welcome} className={buttonVariants({ size: 'sm' })}>
                Create your workspace
              </Link>
            }
          />
        </CardContent>
      )}
    </Card>
  )
}
