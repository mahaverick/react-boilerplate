import { useState } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Button } from '@/components/ui/button'
import { formatInr } from '@/lib/billing-format'
import { intervalPriceLine, upgradeLabel } from '@/lib/billing-page'
import { track } from '@/observability/telemetry'
import type { BillingInterval, PlansResponse, TenantBilling } from '@/types/billing.types'

/** What the plan choice offers and what it does. */
interface PlanChoiceProps {
  billing: TenantBilling
  plans: PlansResponse
  /** Formats a billing date in the tenant's time zone. */
  date: (iso: string) => string
  /** The moment the page reads as now. */
  now: Date
  /** Starts the checkout for the chosen interval. */
  onUpgrade: (interval: BillingInterval) => void
  /** True while this checkout opens or confirms. */
  busy: boolean
  /** True while another billing action runs. */
  disabled: boolean
}

/** The toggle's labels. */
const INTERVAL_LABEL: Record<BillingInterval, string> = { month: 'Monthly', year: 'Yearly' }

/**
 * The owner's way onto Paid: a monthly or yearly toggle, that interval's
 * price from `GET /plans` (the yearly one with its saving), the GST line when
 * the business is GST-registered, and the button. In the trial, a note says
 * what the card is charged and when. While Paid is cancelling, the button
 * keeps Paid after the period instead, until the period ends (`upgradeLabel`).
 */
export function PlanChoice({
  billing,
  plans,
  date,
  now,
  onUpgrade,
  busy,
  disabled,
}: PlanChoiceProps) {
  const prices = plans.plans.find((plan) => plan.key === 'paid')?.prices ?? []
  /** Paid's price for an interval in paise, or `null` when it has none. */
  const priceOf = (interval: BillingInterval) =>
    prices.find((price) => price.interval === interval)?.amountMinor ?? null
  const offered = (['month', 'year'] as const).filter((interval) => priceOf(interval) !== null)
  const [chosen, setChosen] = useState<BillingInterval>(billing.interval ?? 'month')
  const interval = offered.includes(chosen) ? chosen : offered[0]
  if (interval === undefined) return null

  const amount = priceOf(interval)
  const priceLine = intervalPriceLine(interval, priceOf('month'), priceOf('year'))
  const label = upgradeLabel(billing, { now, date })

  return (
    <div className="grid gap-3">
      {offered.length > 1 && (
        <div role="group" aria-label="Billing interval" className="flex gap-2">
          {offered.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === interval ? 'default' : 'outline'}
              aria-pressed={option === interval}
              onClick={() => {
                if (option === interval) return
                setChosen(option)
                track('interval_selected', { interval: option })
              }}
            >
              {INTERVAL_LABEL[option]}
            </Button>
          ))}
        </div>
      )}
      {priceLine !== null && <p className="font-medium">{priceLine}</p>}
      {plans.gstRegistered && <p className="text-sm text-muted-foreground">Includes 18% GST</p>}
      {billing.state === 'trialing' && billing.trialEndsAt !== null && amount !== null && (
        <p className="text-sm text-muted-foreground">
          {`We’ll hold ₹5 on your card now and refund it. Your first charge of ${formatInr(amount)} is on ${date(billing.trialEndsAt)}.`}
        </p>
      )}
      <div>
        <BusyButton
          busy={busy}
          busyLabel="Opening…"
          disabled={disabled}
          onClick={() => {
            onUpgrade(interval)
          }}
        >
          {label}
        </BusyButton>
      </div>
    </div>
  )
}
