import { IconCheck, IconMinus } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatInr } from '@/lib/billing-format'
import { yearlySaving } from '@/lib/billing-page'
import type {
  BillingInterval,
  EntitlementCatalogEntry,
  EntitlementValue,
  PlansResponse,
  PublicPlan,
} from '@/types/billing.types'

/**
 * A plan's price lines: "₹0" for a plan with no price, else the monthly
 * price, then the yearly one with its saving ("or ₹9,990 per year (2 months
 * free)"), both shown.
 * @param plan - The plan.
 * @returns One or two lines.
 */
function priceLines(plan: PublicPlan): string[] {
  /** The plan's price for an interval in paise, or `null` when it has none. */
  const priceOf = (interval: BillingInterval) =>
    plan.prices.find((price) => price.interval === interval)?.amountMinor ?? null
  const monthly = priceOf('month')
  const yearly = priceOf('year')
  if (monthly === null && yearly === null) return [formatInr(0)]
  const lines: string[] = []
  if (monthly !== null) lines.push(`${formatInr(monthly)} per month`)
  if (yearly !== null) {
    const saving = yearlySaving(monthly, yearly)
    const year = `${formatInr(yearly)} per year${saving === null ? '' : ` (${saving})`}`
    lines.push(monthly === null ? year : `or ${year}`)
  }
  return lines
}

/**
 * One catalog entry's value on a plan: a limit's number, or "No limit" for
 * `null`; a feature's tick or dash, named for screen readers. An entry the
 * plan does not list reads as not included.
 */
function EntitlementCell({
  entry,
  value,
}: {
  entry: EntitlementCatalogEntry
  value: EntitlementValue | undefined
}) {
  if (entry.kind === 'limit' && typeof value === 'number') {
    return <span className="font-medium tabular-nums">{value.toLocaleString('en-IN')}</span>
  }
  if (entry.kind === 'limit' && value === null) {
    return <span className="font-medium">No limit</span>
  }
  return value === true ? (
    <span className="text-foreground">
      <IconCheck aria-hidden="true" className="size-4" />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="text-muted-foreground">
      <IconMinus aria-hidden="true" className="size-4" />
      <span className="sr-only">Not included</span>
    </span>
  )
}

/**
 * One plan's column: its name as the region's `h2`, its description, its
 * prices, the GST line on a priced plan when the business is GST-registered,
 * and every catalog entry with the plan's value for it.
 */
function PlanColumn({
  plan,
  catalog,
  gstRegistered,
}: {
  plan: PublicPlan
  catalog: EntitlementCatalogEntry[]
  gstRegistered: boolean
}) {
  const headingId = `plan-${plan.key}`
  const [first, ...rest] = priceLines(plan)
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId} className="font-heading text-lg font-semibold">
            {plan.name}
          </h2>
        </CardTitle>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-2xl font-semibold tabular-nums">{first}</p>
          {rest.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
          {gstRegistered && plan.prices.length > 0 && (
            <p className="text-sm text-muted-foreground">Includes 18% GST</p>
          )}
        </div>
        <ul className="grid gap-2 border-t pt-4 text-sm">
          {catalog.map((entry) => (
            <li key={entry.key} className="flex items-center justify-between gap-4">
              <span>{entry.label}</span>
              <EntitlementCell entry={entry} value={plan.entitlements[entry.key]} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * The plans side by side from `md` up, in `sortOrder`, each with every
 * catalog entry as a row, so the columns compare line by line.
 */
export function PricingTable({ plans }: { plans: PlansResponse }) {
  const sorted = [...plans.plans].sort((a, b) => a.sortOrder - b.sortOrder)
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {sorted.map((plan) => (
        <PlanColumn
          key={plan.key}
          plan={plan}
          catalog={plans.catalog}
          gstRegistered={plans.gstRegistered}
        />
      ))}
    </div>
  )
}
