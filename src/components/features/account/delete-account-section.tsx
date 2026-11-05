import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { WhatWeDelete } from '@/components/features/account/what-we-delete'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  deletionRequestQueryOptions,
  useRequestAccountDeletion,
} from '@/queries/account-deletion.queries'
import { useAuthStore } from '@/states/auth.store'
import type { DeletionRequest } from '@/types/api.types'

/** The most characters express accepts in the reason (`ACCOUNT_DELETION_REASON_MAX_LENGTH`). */
const REASON_MAX_LENGTH = 500

/** What the page says while the open request cannot be read. */
const LOAD_ERROR = 'We couldn’t load your deletion request. Select Try again to load it.'

/** The dates of an open request, from `formatDate`, falling back to the raw value. */
function dateText(iso: string): string {
  return formatDate(iso, 'long') ?? iso
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
  return (
    <p role="status" className="text-sm">
      You asked us to delete your account on {dateText(request.requestedAt)}. We’ll delete it by{' '}
      {dateText(request.dueAt)}.
    </p>
  )
}

/** The reason field and the destructive request button. */
function RequestForm() {
  const mutation = useRequestAccountDeletion()
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const [reason, setReason] = useState('')
  const email = useAuthStore((state) => state.user?.email)
  const reasonId = useId()
  const hintId = useId()

  /** Posts the request, with the reason only when it has text. */
  const submit = () => {
    const trimmed = reason.trim()
    stepUp
      .run(() => mutation.mutateAsync(trimmed === '' ? {} : { reason: trimmed }))
      .then(
        () => toast.success('We’ve got your request. Check your email for a receipt.'),
        (error: unknown) => toast.error(writeFailureMessage(error))
      )
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
          onClick={submit}
        >
          Request deletion
        </BusyButton>
      </div>
    </div>
  )
}
