import { IconCheck, IconLock } from '@tabler/icons-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { UsageMeter } from '@/components/features/billing/usage-meter'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { billingStateLine, hasLiveSubscription, type BillingLineContext } from '@/lib/billing-page'
import { useEntitlements, usePlans } from '@/queries/billing.queries'
import type { EntitlementCatalogEntry, TenantBilling } from '@/types/billing.types'

/** What the overview card shows and what goes under it. */
interface BillingOverviewCardProps {
  slug: string
  /** The billing view; `null` when the API has no billing for this workspace. */
  billing: UseQueryResult<TenantBilling | null>
  /** True while the tenant's time zone loads, so no date shows in the wrong zone first. */
  datesPending: boolean
  context: BillingLineContext
  /** What the viewer may do, under the plan: the owner's actions or a member's prompt. */
  children: (billing: TenantBilling) => ReactNode
}

/**
 * The catalog's label for a key, or the key itself when the plans have not
 * loaded or do not list it.
 * @param catalog - The plans' catalog, when loaded.
 * @param key - The entitlement key.
 */
function labelOf(catalog: EntitlementCatalogEntry[] | undefined, key: string): string {
  return catalog?.find((entry) => entry.key === key)?.label ?? key
}

/**
 * Billing's "Plan" card: the plan, its state line, who pays and where
 * receipts go, a meter for each limit and the features with a tick or a lock.
 * The viewer's actions come last, from `children`.
 */
export function BillingOverviewCard({
  slug,
  billing,
  datesPending,
  context,
  children,
}: BillingOverviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Plan</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {datesPending ? (
          <CardRowsSkeleton rows={2} />
        ) : (
          <QueryState query={billing} name="Billing" skeleton={<CardRowsSkeleton rows={2} />}>
            {(view) =>
              view === null ? (
                <p className="text-sm text-muted-foreground">
                  Billing isn’t available for this workspace.
                </p>
              ) : (
                <>
                  <PlanSummary billing={view} context={context} />
                  <Usage slug={slug} />
                  {children(view)}
                </>
              )
            }
          </QueryState>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The plan's name, its state line (none on Free), and, while Paid is live,
 * the payer and the receipts address.
 */
function PlanSummary({
  billing,
  context,
}: {
  billing: TenantBilling
  context: BillingLineContext
}) {
  // Free and the trial pay nothing, so a payer left from an earlier subscription is not shown.
  const live = hasLiveSubscription(billing)
  const payer = live ? billing.payer : null
  const billingEmail = live ? billing.billingEmail : null
  const stateLine = billingStateLine(billing, context)
  return (
    <div className="grid gap-1">
      <p className="text-lg font-semibold">{billing.plan.name}</p>
      {stateLine !== null && (
        <p data-slot="billing-state" className="text-sm text-muted-foreground">
          {stateLine}
        </p>
      )}
      {payer !== null &&
        (payer.name === '' ? (
          <p className="text-sm text-muted-foreground">Paid with an owner’s card.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Paid with <Pii>{payer.name}</Pii>’s card.
          </p>
        ))}
      {billingEmail !== null && (
        <p className="text-sm text-muted-foreground">
          Receipts go to <Pii>{billingEmail}</Pii>.
        </p>
      )}
    </div>
  )
}

/** A meter for each limit and the features list, from the entitlements, labelled from the catalog. */
function Usage({ slug }: { slug: string }) {
  const entitlements = useEntitlements(slug)
  const catalog = usePlans().data?.catalog
  return (
    <QueryState query={entitlements} name="Usage" skeleton={<CardRowsSkeleton rows={2} />}>
      {(view) => (
        <>
          {Object.entries(view.limits).map(([key, usage]) => (
            <UsageMeter key={key} label={labelOf(catalog, key)} usage={usage} />
          ))}
          {Object.keys(view.features).length > 0 && (
            <ul className="grid gap-2 text-sm">
              {Object.entries(view.features).map(([key, included]) => {
                const label = labelOf(catalog, key)
                return (
                  <li
                    key={key}
                    aria-label={`${label}: ${included ? 'included' : 'not included'}`}
                    className="flex items-center gap-2"
                  >
                    {included ? (
                      <IconCheck aria-hidden="true" className="size-4 text-success" />
                    ) : (
                      <IconLock aria-hidden="true" className="size-4 text-muted-foreground" />
                    )}
                    <span className={included ? undefined : 'text-muted-foreground'}>{label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </QueryState>
  )
}
