import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TrialSummaryDialog } from '@/components/features/billing/trial-summary-dialog'
import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import { BusyButton } from '@/components/shared/busy-button'
import { Note, type NoteTone } from '@/components/shared/note'
import { Pii } from '@/components/shared/pii'
import { useCheckoutFlow } from '@/hooks/use-checkout-flow'
import { useNow } from '@/hooks/use-now'
import { messageFrom } from '@/lib/api-error'
import { pickBillingBanner, trialDaysLeft, type BillingBannerKind } from '@/lib/billing-banner'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import { PAYMENTS_OFF } from '@/lib/billing-page'
import { toast } from '@/lib/toast'
import { useDismissBanner, useTenantBilling } from '@/queries/billing.queries'
import { tenantSettingsQueryOptions } from '@/queries/tenant-forms.queries'
import type { TenantDetail } from '@/queries/tenant.queries'
import type { TenantBilling } from '@/types/billing.types'

/** Each banner's tone: a payment problem or a closing trial asks for action; a running trial only informs. */
const TONES: Record<BillingBannerKind, NoteTone> = {
  past_due: 'warning',
  paused: 'warning',
  payer_left: 'warning',
  trial_ending: 'warning',
  trial_running: 'passive',
  trial_ended: 'info',
}

/** What the banner's sentence needs besides the billing view. */
interface LineContext {
  billing: TenantBilling
  /** True for an owner with member access; everyone else, staff included, reads the member line. */
  isOwner: boolean
  /** Formats a billing date in the tenant's time zone. */
  date: (iso: string) => string
  now: Date
}

/**
 * The past-due sentence. Without a grace end Razorpay is still retrying;
 * without failure details there is no date to give.
 * @param context - The billing view, the viewer and the date format.
 */
function pastDueLine({ billing, isOwner, date }: LineContext): string {
  const pastDue = billing.pastDue
  if (pastDue === null) {
    return isOwner
      ? 'A card payment failed. Update your card to keep Paid.'
      : 'A card payment failed. An owner can update the card.'
  }
  const since = date(pastDue.since)
  const amount = billing.price === null ? '' : ` of ${formatInr(billing.price.amountMinor)}`
  if (pastDue.graceEndsAt === null) {
    return isOwner
      ? `Your card payment${amount} failed on ${since}. Razorpay will try again. Update your card so the next try works.`
      : `A card payment failed on ${since}. An owner can update the card.`
  }
  const graceEndsAt = date(pastDue.graceEndsAt)
  return isOwner
    ? `Your card payment${amount} failed on ${since}. Update your card by ${graceEndsAt} to keep Paid.`
    : `Paid ends on ${graceEndsAt} unless an owner updates the card.`
}

/**
 * The paused sentence: the payer paused the UPI mandate.
 * @param context - The billing view, the viewer and the date format.
 */
function pausedLine({ billing, isOwner, date }: LineContext): string {
  const graceEndsAt = billing.pastDue?.graceEndsAt ?? null
  if (graceEndsAt === null) {
    return isOwner
      ? 'Payments are paused in your UPI app. Resume them there to keep Paid.'
      : 'Payments are paused. An owner can resume them.'
  }
  return isOwner
    ? `Payments are paused in your UPI app. Resume them there by ${date(graceEndsAt)} to keep Paid.`
    : `Paid ends on ${date(graceEndsAt)} unless an owner resumes payments.`
}

/**
 * The payer-left sentence, with the payer's name masked for analytics. An
 * empty name reads "a former member".
 * @param context - The billing view, the viewer and the date format.
 */
function payerLeftLine({ billing, isOwner, date }: LineContext): ReactNode {
  const periodEnd = billing.currentPeriodEnd === null ? null : date(billing.currentPeriodEnd)
  if (!isOwner) {
    return periodEnd === null
      ? 'Paid ends unless an owner adds a card.'
      : `Paid ends on ${periodEnd} unless an owner adds a card.`
  }
  const name = billing.payer?.name ?? ''
  const addCard = `Add your card${periodEnd === null ? '' : ` by ${periodEnd}`} to keep Paid.`
  if (name === '') {
    return `Billing uses the card of a former member, who left the workspace. ${addCard}`
  }
  return (
    <span>
      Billing uses <Pii>{name}</Pii>’s card, and they left the workspace. {addCard}
    </span>
  )
}

/**
 * The banner's sentence.
 * @param kind - Which banner.
 * @param context - The billing view, the viewer, the date format and the clock.
 */
function lineFor(kind: BillingBannerKind, context: LineContext): ReactNode {
  const { billing, date, now } = context
  const trialEndsAt = billing.trialEndsAt ?? ''
  switch (kind) {
    case 'past_due':
      return pastDueLine(context)
    case 'paused':
      return pausedLine(context)
    case 'payer_left':
      return payerLeftLine(context)
    case 'trial_ending':
      return `Your Paid trial ends on ${date(trialEndsAt)}. After that you’re on Free, and nothing is deleted.`
    case 'trial_running':
      return `${trialDaysLeft(trialEndsAt, now)} days left in your Paid trial. Ends ${date(trialEndsAt)}.`
    case 'trial_ended':
      return `Your trial ended on ${date(trialEndsAt)}. You’re on Free.`
  }
}

/**
 * The billing banner under the platform-access banner on every tenant page:
 * a failed or paused payment, a payer who left, or the trial's progress
 * (`pickBillingBanner` picks one). An owner with member access reads the owner
 * line and gets its button; members, and staff through platform access, read
 * the member line with no button. The trial-ended banner also offers everyone
 * "See what changed", which opens the trial summary. Renders nothing for the platform tenant,
 * while billing or the tenant's time zone loads, or when there is nothing to say.
 * `actions={false}`, on Billing, keeps every sentence (and the trial summary and
 * dismiss) but drops the card button and the Upgrade link, the trial summary's
 * included: the page has its own, and a second checkout flow beside the page's
 * could run at the same time.
 */
export function BillingBanner({
  slug,
  tenant,
  actions = true,
}: {
  slug: string
  tenant: TenantDetail
  actions?: boolean
}) {
  const { data: billing } = useTenantBilling(slug)
  const now = useNow()
  const kind =
    tenant.isPlatform || !billing
      ? null
      : pickBillingBanner(billing, new Date(now), tenant.createdAt)
  // Billing dates are the tenant's days, as express writes them; a failed read falls back to UTC like the server.
  const settings = useQuery({
    ...tenantSettingsQueryOptions(slug),
    retry: false,
    enabled: kind !== null,
  })

  if (kind === null || !billing || settings.isPending) return null
  const timeZone = settings.data?.timezone ?? 'UTC'
  const isMember = tenant.access === 'member'
  const isOwner = isMember && tenant.role === 'owner'
  const line = lineFor(kind, {
    billing,
    isOwner,
    date: (iso) => formatBillingDate(iso, timeZone),
    now: new Date(now),
  })

  return (
    <Note tone={TONES[kind]} className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        {actions && kind === 'past_due' && isOwner ? (
          <CardChange slug={slug} label="Update card" line={line} billing={billing} />
        ) : actions && kind === 'payer_left' && isOwner ? (
          <CardChange slug={slug} label="Use my card" line={line} billing={billing} />
        ) : (
          <>
            <span>{line}</span>
            {actions && kind === 'trial_ending' && <UpgradeAction slug={slug} surface="banner" />}
            {kind === 'trial_ended' && (
              <TrialSummaryDialog
                slug={slug}
                trialEndedOn={formatBillingDate(billing.trialEndsAt ?? '', timeZone)}
                upgrade={actions}
              />
            )}
            {kind === 'trial_ended' && isMember && <DismissTrialEnded slug={slug} />}
          </>
        )}
      </div>
    </Note>
  )
}

/**
 * The owner's line with a button that opens Razorpay Checkout for a new
 * card, and the flow's message while it waits or fails. With payments off,
 * the button gives way to a line saying so. Mounted only when shown, so the
 * checkout flow does not run on every tenant page.
 */
function CardChange({
  slug,
  label,
  line,
  billing,
}: {
  slug: string
  label: string
  line: ReactNode
  billing: TenantBilling
}) {
  const flow = useCheckoutFlow(slug)
  const busy = flow.status === 'starting' || flow.status === 'open' || flow.status === 'confirming'
  const showMessage = (flow.status === 'error' || flow.status === 'waiting') && flow.message
  return (
    <>
      <span>{line}</span>
      {billing.paymentsEnabled ? (
        <BusyButton
          size="sm"
          busy={busy}
          busyLabel="Opening…"
          onClick={() => void flow.start({ purpose: 'card_change' })}
        >
          {label}
        </BusyButton>
      ) : (
        <span className="text-sm text-muted-foreground">{PAYMENTS_OFF}</span>
      )}
      {showMessage && <span className="basis-full text-sm">{flow.message}</span>}
    </>
  )
}

/**
 * "Dismiss" on the trial-ended banner. It posts the dismissal; on success
 * `useDismissBanner` tracks it and adds `trial_ended` to the cached view's
 * `dismissedBanners` (the refetch the dismissal triggers says the same), and
 * the banner goes. A refusal keeps the banner and toasts the server's message.
 */
function DismissTrialEnded({ slug }: { slug: string }) {
  const dismiss = useDismissBanner(slug)
  return (
    <BusyButton
      variant="ghost"
      size="sm"
      busy={dismiss.isPending}
      busyLabel="Dismissing…"
      onClick={() => {
        // A promise, not per-call `mutate` callbacks, which TanStack drops if the banner unmounts first.
        void dismiss.mutateAsync('trial_ended').catch((error: unknown) => {
          toast.error(messageFrom(error))
        })
      }}
    >
      Dismiss
    </BusyButton>
  )
}
