import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { messageFrom } from '@/lib/api-error'
import { cancelBody, cancelToast, type BillingLineContext } from '@/lib/billing-page'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { invalidateBilling, useCancelPaid } from '@/queries/billing.queries'
import type { TenantBilling } from '@/types/billing.types'

/** Which workspace's Paid to cancel, as it stands now. */
interface CancelPaidDialogProps {
  slug: string
  billing: TenantBilling
  context: Pick<BillingLineContext, 'now' | 'date'>
  /** True while another billing action runs. */
  disabled: boolean
}

/**
 * "Cancel Paid" and its one-step confirm. The body says what cancelling does
 * from here: Paid ends now after a failed payment, the trial resumes before
 * the first charge, and otherwise Paid lasts to the period's end. The toast
 * reads the state the cancel returned. A refusal toasts the server's message
 * and refetches billing.
 */
export function CancelPaidDialog({ slug, billing, context, disabled }: CancelPaidDialogProps) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  // Hook-level: the cancel usually unmounts this dialog before the mutation settles.
  const cancel = useCancelPaid(slug, {
    onCancelled: (result) => {
      setIsOpen(false)
      toast.success(cancelToast(result, context))
    },
  })

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) track('cancel_started')
        setIsOpen(next)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="outline" disabled={disabled}>
            Cancel Paid
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Paid?</AlertDialogTitle>
          <AlertDialogDescription>{cancelBody(billing, context)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Paid</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => {
              track('cancel_confirmed')
              // A promise, not per-call `mutate` callbacks, which TanStack drops once this dialog unmounts.
              void cancel.mutateAsync().catch((error: unknown) => {
                setIsOpen(false)
                toast.error(messageFrom(error))
                void invalidateBilling(queryClient, slug)
              })
            }}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel Paid'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
