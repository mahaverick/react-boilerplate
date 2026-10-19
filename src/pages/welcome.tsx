import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CreateTenantForm } from '@/components/features/tenant/create-tenant-form'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { BusyButton } from '@/components/shared/busy-button'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { buttonVariants } from '@/components/ui/button'
import { FieldSeparator } from '@/components/ui/field'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useLogout } from '@/queries/auth.queries'
import { useTenants, type Tenant } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

/**
 * The first-tenant step, where a new user lands. Top level, under neither
 * `_auth` nor `_app`: it is for a signed-in user, but without the app shell,
 * so it renders `AuthLayout` itself and guards sign-in on its own. While
 * maintenance is `full` the guard does not redirect, as `_app`'s does not.
 */
export const Route = createFileRoute('/welcome')({
  beforeLoad: () => {
    if (useMaintenanceModeStore.getState().mode === 'full') return
    // __root's beforeLoad has awaited bootstrapSession(), so the store is settled.
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: ROUTES.welcome } })
    }
  },
  head: () => ({ meta: [{ title: pageTitle('Create your workspace') }] }),
  component: WelcomePage,
  pendingComponent: AuthPagePending,
})

/**
 * The create form, with a way past it and a way out. A user who already
 * belongs to a tenant goes to the dashboard; the check reads the list here,
 * not in a loader, because a loader also runs for a hover preload. The check
 * takes the first list this page reads, never a later one: the create
 * refetches the list, which then holds the new tenant, and it can render
 * while the create's own landing is still loading, where a redirect would
 * start after the landing and win. A failed first read counts as no tenant
 * and shows the form, which never redirects afterwards. Until the first read
 * settles the page shows its pending frame, not the form, so no create can
 * start before the decision.
 */
function WelcomePage() {
  const tenants = useTenants()
  const email = useAuthStore((state) => state.user?.email)
  const navigate = useNavigate()
  const logout = useLogout()
  const [firstList, setFirstList] = useState(tenants.data)
  // A failed first read counts as no tenant: the next list may already hold the one this page creates.
  if (firstList === undefined && (tenants.data !== undefined || tenants.isError)) {
    setFirstList(tenants.data ?? [])
  }
  const hasTenant = firstList !== undefined && firstList.length > 0
  useEffect(() => {
    if (hasTenant) void navigate({ to: ROUTES.dashboard, replace: true })
  }, [hasTenant, navigate])
  if (firstList === undefined || hasTenant) return <AuthPagePending />

  /** Announces the new tenant and opens it, replacing this step in history. */
  const onCreated = async (tenant: Tenant) => {
    toast.success(`${tenant.name} created.`)
    await navigate({ to: '/tenants/$slug', params: { slug: tenant.slug }, replace: true })
  }

  return (
    <AuthLayout>
      <AuthCard
        title="Create your workspace"
        description="Name your workspace. You can invite your team next."
      >
        <CreateTenantForm
          submitLabel="Create workspace"
          busyLabel="Creating…"
          onCreated={onCreated}
        />
        <FieldSeparator />
        <div className="grid gap-3 text-center text-sm">
          {email && (
            <p className="text-muted-foreground">
              You’re signed in as <Pii>{email}</Pii>.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to={ROUTES.dashboard}
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            >
              Go to the dashboard
            </Link>
            <BusyButton
              variant="ghost"
              busy={logout.isPending}
              busyLabel="Signing out…"
              className="w-full"
              onClick={() => logout.mutate()}
            >
              Sign out
            </BusyButton>
          </div>
        </div>
      </AuthCard>
    </AuthLayout>
  )
}
