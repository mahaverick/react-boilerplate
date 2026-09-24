import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABELS } from '@/constants/roles'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { inviterName } from '@/queries/invitation.queries'
import { useInvitations, useResendInvitation, useRevokeInvitation } from '@/queries/tenant.queries'
import { INVITATION_NOT_FOUND, type TenantInvitation } from '@/types/api.types'

/** Said of the request, not of the tenant: a failed load is not "none pending". */
const INVITATIONS_ERROR =
  'We could not load the pending invitations, so none are listed here. This is not a sign that there are none.'

/** Resend or revoke found the row accepted, revoked or expired meanwhile. */
const NO_LONGER_PENDING = 'That invitation is no longer pending.'

/**
 * What a failed resend or revoke tells the reader. Anything but the 404 is
 * the server's own message, a 403 for a role the actor can't grant included.
 * The list refetches either way (the hooks' `onSettled`).
 */
function actionFailure(error: unknown): string {
  return codeFrom(error) === INVITATION_NOT_FOUND ? NO_LONGER_PENDING : messageFrom(error)
}

/** The expiry date, in the reader's own locale. */
function expiresOn(expiresAt: string): string {
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return 'an unknown date'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function ResendInvitationButton({
  slug,
  invitation,
}: {
  slug: string
  invitation: TenantInvitation
}) {
  const resend = useResendInvitation(slug)

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={resend.isPending}
      // One of these per row, so the name has to say which row.
      aria-label={`Resend invitation to ${invitation.email}`}
      onClick={() => {
        // `mutateAsync`, not `mutate` with callbacks: the list refetch can
        // unmount this row first, and `mutate`'s callbacks skip an unmounted
        // observer.
        resend.mutateAsync(invitation.id).then(
          () => toast.success(`Invitation resent to ${invitation.email}.`),
          (error: unknown) => toast.error(actionFailure(error))
        )
      }}
    >
      Resend
    </Button>
  )
}

function RevokeInvitationButton({
  slug,
  invitation,
}: {
  slug: string
  invitation: TenantInvitation
}) {
  const revoke = useRevokeInvitation(slug)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={revoke.isPending}
            aria-label={`Revoke invitation to ${invitation.email}`}
          >
            Revoke
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke the invitation to {invitation.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            The link in their email stops working immediately. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => {
              // `mutateAsync` for the same reason as resend: on success the
              // refetched list drops this row, and this component with it.
              revoke.mutateAsync(invitation.id).then(
                () => {
                  setIsOpen(false)
                  toast.success(`Invitation to ${invitation.email} revoked.`)
                },
                (error: unknown) => {
                  setIsOpen(false)
                  toast.error(actionFailure(error))
                }
              )
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One pending invitation.
 *
 * A stacked item at every width rather than a table row with a card twin:
 * one render path keeps every id unique, and there is no fixed-width table
 * to scroll off a phone screen.
 */
function InvitationItem({ slug, invitation }: { slug: string; invitation: TenantInvitation }) {
  return (
    <li className="grid gap-3 rounded-lg border p-4 sm:flex sm:items-center sm:justify-between">
      <div className="grid min-w-0 gap-0.5">
        <span className="font-medium break-all">{invitation.email}</span>
        <span className="text-sm text-muted-foreground">
          {ROLE_LABELS[invitation.role]} · Invited by {inviterName(invitation.invitedBy)}
        </span>
        <span className="text-sm text-muted-foreground">
          Expires {expiresOn(invitation.expiresAt)}
        </span>
      </div>
      <div className="flex gap-2">
        <ResendInvitationButton slug={slug} invitation={invitation} />
        <RevokeInvitationButton slug={slug} invitation={invitation} />
      </div>
    </li>
  )
}

/**
 * Invitations sent and not yet accepted. Mount it for owners and admins
 * only: the list endpoint is `requireRole('owner', 'admin')`, and mounting it
 * is what issues the request.
 */
export function PendingInvitations({ slug }: { slug: string }) {
  const invitations = useInvitations(slug)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Pending invitations</h2>
        </CardTitle>
        <CardDescription>Sent, and not yet accepted.</CardDescription>
      </CardHeader>
      <CardContent>
        {invitations.isError ? (
          <LoadError message={INVITATIONS_ERROR} onRetry={() => void invitations.refetch()} />
        ) : invitations.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : invitations.data.length === 0 ? (
          // After the error branch: `[]` means "none pending" only once the
          // request has answered.
          <p className="text-sm text-muted-foreground">
            No invitations are waiting to be accepted.
          </p>
        ) : (
          <ul className="grid gap-3">
            {invitations.data.map((invitation) => (
              <InvitationItem key={invitation.id} slug={slug} invitation={invitation} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
