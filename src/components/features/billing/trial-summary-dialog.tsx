import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import { LoadError } from '@/components/features/load-error'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { trialSummary, type TrialSummaryLine } from '@/lib/trial-summary'
import { track } from '@/observability/telemetry'
import { entitlementsQueryOptions, plansQueryOptions } from '@/queries/billing.queries'

/** Which workspace's trial ended, and when. */
interface TrialSummaryDialogProps {
  slug: string
  /** The trial's end, already written in the tenant's time zone ("2 November 2026"). */
  trialEndedOn: string
  /** `false` on Billing, which has its own way onto Paid: the footer offers Close only. */
  upgrade?: boolean
}

/**
 * "See what changed" on the trial-ended banner, and the dialog it opens: what
 * the move to Free changes for this workspace (`trialSummary`), or that
 * nothing does, then Upgrade for an owner or Request upgrade for any other
 * member (nothing for staff), and Close. With `upgrade={false}` only Close. The
 * entitlements and plans are read only while the dialog is open. Opening it
 * tracks `trial_summary_viewed`.
 */
export function TrialSummaryDialog({
  slug,
  trialEndedOn,
  upgrade = true,
}: TrialSummaryDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) track('trial_summary_viewed')
        setIsOpen(next)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        See what changed
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Your trial ended on {trialEndedOn}</DialogTitle>
        </DialogHeader>
        {isOpen && <SummaryBody slug={slug} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          {upgrade && <UpgradeAction slug={slug} surface="banner" size="default" />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The summary's lines, with a skeleton while they load and a retry when
 * either read fails. Mounted only while the dialog is open.
 */
function SummaryBody({ slug }: { slug: string }) {
  const entitlements = useQuery({ ...entitlementsQueryOptions(slug), retry: false })
  const plans = useQuery({ ...plansQueryOptions(), retry: false })

  if (entitlements.isError || plans.isError) {
    return (
      <LoadError
        message="What changes didn’t load. Try again."
        onRetry={() => {
          if (entitlements.isError) void entitlements.refetch()
          if (plans.isError) void plans.refetch()
        }}
      />
    )
  }
  if (!entitlements.data || !plans.data) return <CardRowsSkeleton rows={2} />

  const free = plans.data.plans.find((plan) => plan.key === 'free')
  const paid = plans.data.plans.find((plan) => plan.key === 'paid')
  const lines: TrialSummaryLine[] =
    free && paid ? trialSummary(entitlements.data, free, paid, plans.data.catalog) : []

  if (lines.length === 0) return <p>Nothing changes for you on Free.</p>
  return (
    <div className="grid gap-2">
      <p>On Free, these change:</p>
      <ul className="list-disc pl-5">
        {lines.map((item) => (
          <li key={item.key}>{item.line}</li>
        ))}
      </ul>
    </div>
  )
}
