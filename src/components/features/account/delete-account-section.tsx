import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { WhatWeDelete } from '@/components/features/account/what-we-delete'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { formatDate, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  type DeletionRequestAnswer,
  deletionRequestQueryOptions,
  useRequestAccountDeletion,
} from '@/queries/account-deletion.queries'
import { useClientSettings } from '@/queries/client-settings.queries'
import { useAuthStore } from '@/states/auth.store'
import type { DeletionRequest } from '@/types/api.types'

/** The most characters express accepts in the reason (`ACCOUNT_DELETION_REASON_MAX_LENGTH`). */
const REASON_MAX_LENGTH = 500

/** What the page says while the open request cannot be read. */
const LOAD_ERROR = 'We couldn’t load your deletion request. Select Try again to load it.'

/** The day a request was made, from `formatDate`, falling back to the raw value. */
function dateText(iso: string): string {
  return formatDate(iso, 'long') ?? iso
}

/** The due time, with the hour and zone the receipt email gives, falling back to the raw value. */
function dueText(iso: string): string {
  return formatDateTime(iso) ?? iso
}

/**
 * Where to withdraw a request: express has no cancel route, and its receipt email
 * names the support address for it, which `GET /status/client-settings` also
 * gives. Without that read, the words point at the email.
 */
function writeToSupport(supportEmail: string | undefined): string {
  return supportEmail === undefined
    ? 'write to the support address in your receipt email'
    : `write to ${supportEmail}`
}

/** The toast after a request: express's own message, else one worded for 201 or 200. */
function receiptToast(answer: DeletionRequestAnswer): string {
  return (
    answer.message ||
    (answer.created
      ? 'We’ve got your request. Check your email for a receipt.'
      : 'You already asked us to delete your account. We sent the receipt then.')
  )
}

/**
 * Settings › Delete account. With no open request it offers the optional reason
 * and the request button, which runs through "Confirm it’s you" because express
 * refuses the write without a recent sign-in. With one open it shows its dates
 * instead.
 */
export function DeleteAccountSection() {
  const headingId = useId()
  const request = useQuery(deletionRequestQueryOptions())

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      <h2 id={headingId} className="sr-only">
        Delete account
      </h2>
      <QueryState
        query={request}
        name="Deletion request"
        errorMessage={LOAD_ERROR}
        className="gap-6"
        skeleton={<Skeleton className="h-24 w-full" />}
      >
        {(open) => (open ? <OpenRequest request={open} /> : <RequestForm />)}
      </QueryState>
      <WhatWeDelete />
    </section>
  )
}

/** The open request: when it was made and when we will have deleted the account by. */
function OpenRequest({ request }: { request: DeletionRequest }) {
  const supportEmail = useClientSettings()?.supportEmail
  return (
    <p role="status" className="text-sm">
      You asked us to delete your account on {dateText(request.requestedAt)}. We’ll delete it by{' '}
      {dueText(request.dueAt)}. To withdraw the request, {writeToSupport(supportEmail)} before then.
    </p>
  )
}

/** The reason field and the destructive request button. */
function RequestForm() {
  const mutation = useRequestAccountDeletion()
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const supportEmail = useClientSettings()?.supportEmail
  const email = useAuthStore((state) => state.user?.email)
  const reasonId = useId()
  const hintId = useId()

  /** Posts the request, with the reason only when it has text. */
  const submit = () => {
    const trimmed = reason.trim()
    stepUp
      .run(() => mutation.mutateAsync(trimmed === '' ? {} : { reason: trimmed }))
      .then(
        (answer) => toast.success(receiptToast(answer)),
        (error: unknown) => toast.error(writeFailureMessage(error))
      )
      .finally(() => setConfirming(false))
  }

  return (
    <div className="grid gap-4">
      <p id={hintId} className="text-sm">
        Ask us to delete your account. Our team deletes it within 30 days and emails you when it’s
        done.
      </p>
      <Field>
        <FieldLabel htmlFor={reasonId}>Why are you leaving?</FieldLabel>
        <Textarea
          id={reasonId}
          value={reason}
          maxLength={REASON_MAX_LENGTH}
          onChange={(event) => setReason(event.target.value)}
        />
        <FieldDescription>Optional. Up to {REASON_MAX_LENGTH} characters.</FieldDescription>
      </Field>
      {email ? (
        <p className="text-sm text-muted-foreground">
          We send the confirmation to <Pii>{email}</Pii>.
        </p>
      ) : null}
      <div>
        <BusyButton
          variant="destructive"
          busy={mutation.isPending || stepping}
          busyLabel={stepping ? STEP_UP_WAITING_LABEL : 'Requesting…'}
          aria-describedby={hintId}
          onClick={() => setConfirming(true)}
        >
          Request deletion
        </BusyButton>
      </div>
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => {
          // While the request waits on "Confirm it's you", Escape and outside presses belong to it.
          if (!next && stepping) return
          setConfirming(next)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ask us to delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Our team deletes it by the date in your receipt email, at most 30 days from now. You
              stay signed in until then. To withdraw the request, {writeToSupport(supportEmail)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={mutation.isPending || stepping}
              onClick={submit}
            >
              {stepping ? STEP_UP_WAITING_LABEL : mutation.isPending ? 'Sending…' : 'Send request'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
