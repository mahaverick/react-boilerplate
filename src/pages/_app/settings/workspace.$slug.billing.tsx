import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { BillingOverviewCard } from '@/components/features/billing/billing-overview-card'
import { InvoicesCard } from '@/components/features/billing/invoices-card'
import { OwnerBillingActions } from '@/components/features/billing/owner-billing-actions'
import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import { UpgradeRequestsCard } from '@/components/features/billing/upgrade-requests-card'
import { SettingsRouteError } from '@/components/features/route-error'
import { Note } from '@/components/shared/note'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { useNow } from '@/hooks/use-now'
import { formatBillingDate } from '@/lib/billing-format'
import type { BillingLineContext } from '@/lib/billing-page'
import { track } from '@/observability/telemetry'
import { usePlans, useTenantBilling } from '@/queries/billing.queries'
import { tenantSettingsQueryOptions } from '@/queries/tenant-forms.queries'
import { useTenant, type TenantDetail } from '@/queries/tenant.queries'
import type { BillingInterval } from '@/types/billing.types'

/** Settings › Workspace › Billing: the plan, usage, the card, invoices and upgrade requests. */
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

/** Tracks the page view, then shows the page, or one line for the platform tenant, which has no billing. */
function WorkspaceBilling() {
  // Not `Route.useParams()`: this route module imports the error screen (route-error, then observability/errors), and a page chunk importing `Route` back from it makes Rolldown split the error listener out of the entry chunk (pnpm check:bundle).
  const { slug } = useParams({ from: '/_app/settings/workspace/$slug/billing' })
  const { data: tenant } = useTenant(slug)
  const viewed = useRef(false)

  useEffect(() => {
    if (viewed.current) return
    viewed.current = true
    track('billing_page_viewed')
  }, [])

  // The workspace gate renders this page only once the tenant has loaded.
  if (!tenant) return null
  if (tenant.isPlatform) {
    return <Note tone="passive">The platform workspace has no billing.</Note>
  }
  return <BillingPage slug={slug} tenant={tenant} />
}

/**
 * The page for a customer workspace. Everyone sees the plan card. An owner
 * with member access also gets its actions, the upgrade requests and, while
 * payments are on, the invoices. Other members read that only owners change
 * billing, with a way to ask on Free. Staff through platform access read the
 * plan card only.
 */
function BillingPage({ slug, tenant }: { slug: string; tenant: TenantDetail }) {
  const billing = useTenantBilling(slug)
  const plans = usePlans()
  const now = useNow()
  // Billing dates are the tenant's days, as express writes them; a failed read falls back to UTC like the server.
  const settings = useQuery({ ...tenantSettingsQueryOptions(slug), retry: false })
  const timeZone = settings.data?.timezone ?? 'UTC'
  const isMember = tenant.access === 'member'
  const isOwner = isMember && tenant.role === 'owner'
  const paidPrices = plans.data?.plans.find((plan) => plan.key === 'paid')?.prices ?? []
  const context: BillingLineContext = {
    now: new Date(now),
    date: (iso) => formatBillingDate(iso, timeZone),
    priceFor: (interval: BillingInterval) =>
      paidPrices.find((price) => price.interval === interval)?.amountMinor ?? null,
  }

  return (
    <div className="grid gap-4">
      {isMember && !isOwner && <Note tone="info">Only owners can change billing.</Note>}
      <BillingOverviewCard
        slug={slug}
        billing={billing}
        datesPending={settings.isPending}
        context={context}
      >
        {(view) =>
          isOwner ? (
            <OwnerBillingActions slug={slug} billing={view} context={context} />
          ) : (
            view.state === 'free' && (
              <div>
                <UpgradeAction slug={slug} surface="billing_page" />
              </div>
            )
          )
        }
      </BillingOverviewCard>
      {isOwner && <UpgradeRequestsCard slug={slug} timeZone={timeZone} />}
      {isOwner && billing.data?.paymentsEnabled === true && (
        <InvoicesCard slug={slug} timeZone={timeZone} />
      )}
    </div>
  )
}
