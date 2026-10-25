import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { PricingFaq } from '@/components/features/billing/pricing-faq'
import { PricingTable } from '@/components/features/billing/pricing-table'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/page-skeleton'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { buttonVariants } from '@/components/ui/button'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { PAYMENTS_OFF } from '@/lib/billing-page'
import { tenantSearchSchema } from '@/lib/current-tenant'
import { track } from '@/observability/telemetry'
import { usePlans } from '@/queries/billing.queries'
import { useTenants } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlansResponse } from '@/types/billing.types'

/**
 * The public pricing page, for signed-in and signed-out visitors alike. Top
 * level, under neither `_auth` nor `_app`, so it has no guard and renders
 * `AuthLayout` itself. `?tenant=<slug>` names the current tenant, as it does
 * in the shell, so a link from a workspace can offer that workspace's owner
 * the upgrade. `GET /plans` is public: a signed-out read carries no bearer and
 * gets no 401, so it never starts a refresh or a sign-in redirect.
 */
export const Route = createFileRoute('/pricing')({
  validateSearch: tenantSearchSchema,
  head: () => ({ meta: [{ title: pageTitle('Pricing') }] }),
  component: PricingPage,
  pendingComponent: AuthPagePending,
})

/** The primary link's look. */
const PRIMARY = buttonVariants({ variant: 'default' })

/**
 * A signed-in visitor's next step: the owner of the current tenant upgrades
 * it from its Billing page, or hears that payments are off; anyone else goes
 * to their workspaces. Nothing shows until the tenant list loads, so the
 * owner's link never replaces another one on screen.
 */
function SignedInAction({ paymentsEnabled }: { paymentsEnabled: boolean }) {
  const slug = useCurrentTenantSlug()
  const tenants = useTenants()
  if (slug !== null && tenants.data === undefined && !tenants.isError) return null
  const owns =
    slug !== null &&
    tenants.data?.some((entry) => entry.tenant.slug === slug && entry.role === 'owner') === true
  if (slug !== null && owns) {
    return paymentsEnabled ? (
      <Link to="/settings/workspace/$slug/billing" params={{ slug }} className={PRIMARY}>
        Upgrade
      </Link>
    ) : (
      <p className="text-sm text-muted-foreground">{PAYMENTS_OFF}</p>
    )
  }
  return (
    <Link to={ROUTES.tenants} className={PRIMARY}>
      Go to your workspaces
    </Link>
  )
}

/**
 * The page's call to action. A signed-out visitor starts on Free through
 * sign-in, which creates the account; the trial line says what Paid adds. A
 * signed-in one gets `SignedInAction`, which alone reads the tenant list, so
 * a signed-out visit asks the API for the plans only.
 */
function PricingAction({ plans, signedIn }: { plans: PlansResponse; signedIn: boolean }) {
  if (signedIn) return <SignedInAction paymentsEnabled={plans.paymentsEnabled} />
  return (
    <div className="flex flex-col items-center gap-2">
      <Link to={ROUTES.login} className={PRIMARY}>
        Start free
      </Link>
      {plans.trial.enabled && (
        <p className="text-sm text-muted-foreground">
          {`Try Paid free for ${String(plans.trial.days)} days. No card needed.`}
        </p>
      )}
    </div>
  )
}

/**
 * The plans side by side, the call to action and the questions. The view is
 * tracked once per mount, as signed in or not; the ref keeps StrictMode's
 * second effect run from tracking it twice.
 */
function PricingPage() {
  const signedIn = useAuthStore((state) => state.isAuthenticated)
  const plans = usePlans()
  const viewed = useRef(false)
  useEffect(() => {
    if (viewed.current) return
    viewed.current = true
    track('pricing_viewed', { signed_in: signedIn })
  }, [signedIn])

  return (
    <AuthLayout>
      <h1 className="text-center font-heading text-2xl font-bold">Plans</h1>
      <QueryState
        query={plans}
        name="Plans"
        className="gap-6"
        skeleton={<CardRowsSkeleton rows={4} />}
      >
        {(data) => (
          <>
            <PricingTable plans={data} />
            <div className="flex justify-center">
              <PricingAction plans={data} signedIn={signedIn} />
            </div>
            <PricingFaq gstRegistered={data.gstRegistered} />
          </>
        )}
      </QueryState>
    </AuthLayout>
  )
}
