import { useState } from 'react'
import { CancelPaidDialog } from '@/components/features/billing/cancel-paid-dialog'
import { PlanChoice } from '@/components/features/billing/plan-choice'
import { BusyButton } from '@/components/shared/busy-button'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { useCheckoutFlow, type CheckoutKind } from '@/hooks/use-checkout-flow'
import {
  canChangeSubscription,
  showsPlanChoice,
  switchArea,
  type BillingLineContext,
} from '@/lib/billing-page'
import { usePlans } from '@/queries/billing.queries'
import type { TenantBilling } from '@/types/billing.types'

/** The line an owner sees in place of every billing write while payments are off. */
const PAYMENTS_OFF = 'Payments aren’t set up yet.'

/** Which checkout a click started, so only its button shows the spinner. */
type CheckoutAction = CheckoutKind['purpose']

/**
 * What an owner with member access may do on Billing in this state: take
 * Paid (or keep it after a cancel), switch the interval, put on a new card,
 * or cancel. All of them run through one checkout flow, whose message shows
 * while it waits or fails. With payments off, one line replaces them all,
 * since the API refuses every write then.
 */
export function OwnerBillingActions({
  slug,
  billing,
  context,
}: {
  slug: string
  billing: TenantBilling
  context: BillingLineContext
}) {
  if (!billing.paymentsEnabled) {
    return <p className="text-sm text-muted-foreground">{PAYMENTS_OFF}</p>
  }
  return <Actions slug={slug} billing={billing} context={context} />
}

/** The actions themselves, mounted only while payments are on so the flow runs only then. */
function Actions({
  slug,
  billing,
  context,
}: {
  slug: string
  billing: TenantBilling
  context: BillingLineContext
}) {
  const flow = useCheckoutFlow(slug)
  const plans = usePlans()
  const [action, setAction] = useState<CheckoutAction | null>(null)
  const running =
    flow.status === 'starting' || flow.status === 'open' || flow.status === 'confirming'
  const showMessage = (flow.status === 'error' || flow.status === 'waiting') && flow.message
  const switching = switchArea(billing, context)

  /** Starts a checkout and remembers which button started it. */
  const start = (kind: CheckoutKind) => {
    setAction(kind.purpose)
    void flow.start(kind)
  }

  return (
    <div className="grid gap-4">
      {showsPlanChoice(billing) && (
        <QueryState query={plans} name="Plans" skeleton={<CardRowsSkeleton rows={2} />}>
          {(data) => (
            <PlanChoice
              billing={billing}
              plans={data}
              date={context.date}
              busy={running && action === 'upgrade'}
              disabled={running}
              onUpgrade={(interval) => {
                start({ purpose: 'upgrade', interval })
              }}
            />
          )}
        </QueryState>
      )}
      {switching?.kind === 'line' && <p className="text-sm">{switching.text}</p>}
      {(switching?.kind === 'button' || canChangeSubscription(billing)) && (
        <div className="flex flex-wrap gap-2">
          {switching?.kind === 'button' && (
            <BusyButton
              variant="outline"
              busy={running && action === 'switch'}
              busyLabel="Opening…"
              disabled={running}
              onClick={() => {
                start({ purpose: 'switch', interval: switching.interval })
              }}
            >
              {switching.label}
            </BusyButton>
          )}
          {canChangeSubscription(billing) && (
            <>
              <BusyButton
                variant="outline"
                busy={running && action === 'card_change'}
                busyLabel="Opening…"
                disabled={running}
                onClick={() => {
                  start({ purpose: 'card_change' })
                }}
              >
                Update card
              </BusyButton>
              <CancelPaidDialog
                slug={slug}
                billing={billing}
                context={context}
                disabled={running}
              />
            </>
          )}
        </div>
      )}
      {/* Mounted while empty, so a screen reader announces the message when it appears. */}
      <p role="status" className="text-sm empty:hidden">
        {showMessage ? flow.message : null}
      </p>
    </div>
  )
}
