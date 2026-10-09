import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
import { Pii } from '@/components/shared/pii'
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
import { canActorGrantRole, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { codeFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { writeFailureMessage } from '@/lib/write-failure'
import { inviterName } from '@/queries/invitation.queries'
import { useInvitations, useResendInvitation, useRevokeInvitation } from '@/queries/tenant.queries'
import { INVITATION_NOT_FOUND, type TenantInvitation } from '@/types/api.types'

/** Said of the request, not of the tenant: a failed load is not "none pending". */
const INVITATIONS_ERROR =
  'We could not load the pending invitations, so none are listed here. This is not a sign that there are none.'

/**
 * Why Resend and Revoke are off: both re-check `canActorGrantRole` against the
 * invitation's role, so an admin's resend or revoke of an owner or admin
 * invite is refused.
 */
const GRANT_REASON = 'Only an owner can resend or revoke an invitation for this role.'

/** Resend or revoke found the row accepted, revoked or expired meanwhile. */
const NO_LONGER_PENDING = 'That invitation is no longer pending.'

/**
 * What a failed resend or revoke tells the reader. Anything but the 404 is
 * the server's own message, a 403 for a role the actor can't grant included.
 * The list refetches either way (the hooks' `onSettled`).
 */
function actionFailure(error: unknown): string {
  return codeFrom(error) === INVITATION_NOT_FOUND ? NO_LONGER_PENDING : writeFailureMessage(error)
}

/** The expiry date, in the reader's own locale. */
function expiresOn(expiresAt: string): string {
  return formatDate(expiresAt, 'medium') ?? 'an unknown date'
}

/**
 * Resend for one row, named after the invitee since there is one per row.
 * With `reasonId` (the actor may not grant the invitation's role) the button
 * is disabled and described by the row's one reason, which `InvitationItem`
 * renders as visible text: a disabled button has `pointer-events: none`, so a
 * tooltip on it would never open. It uses `mutateAsync`, because the list
 * refetch can unmount this row first and `mutate`'s callbacks skip an
 * unmounted observer.
 */
function ResendInvitationButton({
  slug,
  invitation,
  reasonId,
}: {
  slug: string
  invitation: TenantInvitation
  /** The row's grant-rule reason, when the actor may not act on this invitation. */
  reasonId?: string
}) {
  const resend = useResendInvitation(slug)

  if (reasonId) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-label={`Resend invitation to ${invitation.email}`}
        aria-describedby={reasonId}
      >
        Resend
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={resend.isPending}
      aria-label={`Resend invitation to ${invitation.email}`}
      onClick={() => {
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

/**
 * Revoke for one row, behind a confirmation; `mutateAsync` for the same
 * reason as resend. With `reasonId` it is disabled and described by the
 * row's one reason, as Resend is.
 */
function RevokeInvitationButton({
  slug,
  invitation,
  reasonId,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  /** The row's grant-rule reason, when the actor may not act on this invitation. */
  reasonId?: string
  /** Called once the revoke has succeeded and the list has refetched. */
  onRevoked: () => void
}) {
  const revoke = useRevokeInvitation(slug)
  const [isOpen, setIsOpen] = useState(false)

  if (reasonId) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-label={`Revoke invitation to ${invitation.email}`}
        aria-describedby={reasonId}
      >
        Revoke
      </Button>
    )
  }

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
          <AlertDialogTitle>
            Revoke the invitation to <Pii>{invitation.email}</Pii>?
          </AlertDialogTitle>
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
              revoke.mutateAsync(invitation.id).then(
                () => {
                  setIsOpen(false)
                  onRevoked()
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
 *
 * When the actor may not grant the invitation's role, Resend and Revoke are
 * both off and the reason renders once, under them, with both pointing at it.
 */
function InvitationItem({
  slug,
  invitation,
  myRole,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  myRole: MembershipRole
  onRevoked: () => void
}) {
  const reasonId = canActorGrantRole(myRole, invitation.role)
    ? undefined
    : `grant-reason-${invitation.id}`

  return (
    <li className="grid gap-3 rounded-lg border p-4 sm:flex sm:items-center sm:justify-between">
      <div className="grid min-w-0 gap-0.5">
        <Pii className="font-medium break-all">{invitation.email}</Pii>
        <span className="text-sm text-muted-foreground">
          {ROLE_LABELS[invitation.role]} · Invited by <Pii>{inviterName(invitation.invitedBy)}</Pii>
        </span>
        <span className="text-sm text-muted-foreground">
          Expires {expiresOn(invitation.expiresAt)}
        </span>
      </div>
      <div className="grid gap-1">
        <div className="flex gap-2">
          <ResendInvitationButton slug={slug} invitation={invitation} reasonId={reasonId} />
          <RevokeInvitationButton
            slug={slug}
            invitation={invitation}
            reasonId={reasonId}
            onRevoked={onRevoked}
          />
        </div>
        {reasonId && (
          <p id={reasonId} className="text-xs text-muted-foreground">
            {GRANT_REASON}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * Invitations sent and not yet accepted. Mount it for owners and admins
 * only: the list endpoint is `requireRole('owner', 'admin')`, and mounting it
 * is what issues the request. A successful revoke moves focus to this heading,
 * since the row that held the button is gone.
 */
export function PendingInvitations({ slug, myRole }: { slug: string; myRole: MembershipRole }) {
  const invitations = useInvitations(slug)
  const focus = useFocusAfter<'heading'>()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={focus.target('heading')} tabIndex={-1} className="outline-none">
            Pending invitations
          </h2>
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
          <p className="text-sm text-muted-foreground">
            No invitations are waiting to be accepted.
          </p>
        ) : (
          <ul className="grid gap-3">
            {invitations.data.map((invitation) => (
              <InvitationItem
                key={invitation.id}
                slug={slug}
                invitation={invitation}
                myRole={myRole}
                onRevoked={() => {
                  focus.focusAfter('heading')
                }}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
