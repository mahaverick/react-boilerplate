import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, useState } from 'react'
import { ROLE_FILTER } from '@/components/features/tenant/role-filter'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { canActorGrantRole, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { useCountdown } from '@/hooks/use-countdown'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, retryAfterSecondsFrom } from '@/lib/api-error'
import { formatTimeLeft } from '@/lib/countdown'
import { formatDate } from '@/lib/format'
import { isMembersLimitRefusal, NOT_SENT_AT_LIMIT } from '@/lib/members-limit'
import { toast } from '@/lib/toast'
import { writeFailureMessage } from '@/lib/write-failure'
import { analyticsKey } from '@/observability/telemetry'
import { inviterName } from '@/queries/invitation.queries'
import {
  invitationsList,
  invitationsListOptions,
  useResendInvitation,
  useRevokeInvitation,
} from '@/queries/tenant.queries'
import { INVITATION_NOT_FOUND, type TenantInvitation } from '@/types/api.types'

/** Said of the request, not of the tenant: a failed load is not "none pending". */
const INVITATIONS_ERROR = 'We couldn’t load the pending invitations. Select Try again to load them.'

/**
 * Why Resend and Revoke are off: both re-check `canActorGrantRole` against the
 * invitation's role, so an admin's resend or revoke of an owner or admin
 * invite is refused.
 */
const GRANT_REASON = 'Only an owner can resend or revoke an invitation for this role.'

/** Resend or revoke found the row accepted, revoked or expired meanwhile. */
const NO_LONGER_PENDING = 'That invitation is no longer pending.'

/** The code express answers a resend with while the cooldown from the last send is running. */
const RESEND_COOLDOWN = 'invitation_resend_cooldown'

/**
 * What a failed resend or revoke tells the reader. A step-up refusal
 * (`writeFailureMessage`) says whether the confirmation was dismissed or did
 * not take. "No longer pending" is for `invitation_not_found`; anything else is
 * the server's own message (a 403 for a role the actor can't grant included).
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
 * When Resend opens again, as epoch ms: the later of the server's
 * `resendAvailableAt` and a locally held deadline. A `null` or unreadable
 * time counts as none, so it never poisons the other with `NaN`.
 */
function resendDeadline(
  resendAvailableAt: string | null,
  localUntil: number | null
): number | null {
  const server = resendAvailableAt === null ? Number.NaN : Date.parse(resendAvailableAt)
  const times = [server, localUntil ?? Number.NaN].filter(Number.isFinite)
  return times.length === 0 ? null : Math.max(...times)
}

/**
 * Resend for one row, named after the invitee since there is one per row.
 * With `reasonId` (the actor may not grant the invitation's role) the button
 * is disabled and described by the row's one reason, which `InvitationItem`
 * renders as visible text: a disabled button has `pointer-events: none`, so a
 * tooltip on it would never open. It uses `mutateAsync`, because the list
 * refetch can unmount this row first and `mutate`'s callbacks skip an
 * unmounted observer.
 *
 * While express's resend cooldown runs, the button reads "Resend in 4 min"
 * and stays focusable (`aria-disabled`), so a keyboard user can still reach
 * it. The deadline is the later of the row's `resendAvailableAt` and the
 * `Retry-After` of a 429 this button just got. The text is not a live
 * region, so it does not announce every tick. At zero the button re-enables
 * without a refetch.
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
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const [localUntil, setLocalUntil] = useState<number | null>(null)
  const left = useCountdown(
    reasonId ? null : resendDeadline(invitation.resendAvailableAt, localUntil)
  )

  if (reasonId) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-label={`Resend, invitation to ${invitation.email}`}
        aria-describedby={reasonId}
      >
        Resend
      </Button>
    )
  }

  const waiting = left > 0
  return (
    <Button
      variant="outline"
      size="sm"
      // The refused resend is not pending while its step-up waits, so a second press would start another.
      disabled={waiting || resend.isPending || stepping}
      focusableWhenDisabled
      aria-label={
        waiting
          ? `Resend in ${formatTimeLeft(left)}, invitation to ${invitation.email}`
          : `Resend, invitation to ${invitation.email}`
      }
      onClick={() => {
        if (waiting) return
        stepUp
          .run(() => resend.mutateAsync(invitation.id))
          .then(
            () => toast.success(`Invitation resent to ${invitation.email}.`),
            (error: unknown) => {
              if (codeFrom(error) === RESEND_COOLDOWN) {
                const wait = retryAfterSecondsFrom(error)
                if (wait !== null) setLocalUntil(Date.now() + wait * 1_000)
              }
              toast.error(isMembersLimitRefusal(error) ? NOT_SENT_AT_LIMIT : actionFailure(error))
            }
          )
      }}
    >
      {waiting ? `Resend in ${formatTimeLeft(left)}` : 'Resend'}
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
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
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
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        // While the revoke waits on "Confirm it's you", Escape and outside presses belong to it.
        if (!next && stepping) return
        setIsOpen(next)
      }}
    >
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
            The link in their email stops working immediately. You can invite them again from this
            page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending || stepping}
            onClick={() => {
              stepUp
                .run(() => revoke.mutateAsync(invitation.id))
                .then(
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
 * Resend and Revoke for one invitation, the table's Actions cell and the
 * card's action area alike.
 *
 * When the actor may not grant the invitation's role, both are off and the
 * reason renders once, under them, with both pointing at it.
 */
function InvitationActions({
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
  )
}

/** One pending invitation as a stacked card, for phones. */
function InvitationItem({
  slug,
  invitation,
  myRole,
  readOnly,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  myRole: MembershipRole
  /** Staff through platform access: no Resend and no Revoke. */
  readOnly: boolean
  onRevoked: () => void
}) {
  return (
    <Item variant="outline" role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          <Pii className="break-all">{invitation.email}</Pii>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {ROLE_LABELS[invitation.role]} · Invited by <Pii>{inviterName(invitation.invitedBy)}</Pii>
        </ItemDescription>
        <ItemDescription className="line-clamp-none">
          Expires {expiresOn(invitation.expiresAt)}
        </ItemDescription>
      </ItemContent>
      {!readOnly && (
        <ItemActions className="grid gap-1">
          <InvitationActions
            slug={slug}
            invitation={invitation}
            myRole={myRole}
            onRevoked={onRevoked}
          />
        </ItemActions>
      )}
    </Item>
  )
}

/** What the invitations panel hands its cells: the tenant, the caller's role and the revoke callback. */
interface InvitationsPanelContext {
  slug: string
  myRole: MembershipRole
  onRevoked: () => void
}

const InvitationsPanelScope = createContext<InvitationsPanelContext | null>(null)

/**
 * The table's Actions cell. The columns are module-level, so the cell reads
 * what changes between renders from context, and re-renders in place rather
 * than remounting with its dialog state.
 */
function InvitationActionsCell({ invitation }: { invitation: TenantInvitation }) {
  const panel = useContext(InvitationsPanelScope)
  if (panel === null) throw new Error('An invitation cell renders inside the invitations panel.')
  return <InvitationActions {...panel} invitation={invitation} />
}

const column = createColumnHelper<DataTableFeatures, TenantInvitation>()

/** The email, role, sent and expiry columns every viewer sees. */
const READ_COLUMNS = [
  column.accessor('email', {
    header: 'Email',
    meta: { sorts: ['email'], sortName: analyticsKey('email') },
    cell: ({ getValue }) => <Pii className="break-all">{getValue()}</Pii>,
  }),
  column.accessor('role', { header: 'Role', cell: ({ getValue }) => ROLE_LABELS[getValue()] }),
  column.accessor('createdAt', {
    header: 'Invited',
    meta: { sorts: ['-created'], sortName: analyticsKey('created'), sortWords: 'date' },
    cell: ({ row }) => (
      <span className="grid">
        <span>{formatDate(row.original.createdAt, 'medium') ?? 'Unknown'}</span>
        <span className="text-xs text-muted-foreground">
          by <Pii>{inviterName(row.original.invitedBy)}</Pii>
        </span>
      </span>
    ),
  }),
  column.accessor('expiresAt', {
    header: 'Expires',
    cell: ({ getValue }) => expiresOn(getValue()),
  }),
]

/** The columns of a caller who can resend and revoke: the read columns, then Actions. */
const INVITATION_COLUMNS = column.columns([
  ...READ_COLUMNS,
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true },
    cell: ({ row }) => <InvitationActionsCell invitation={row.original} />,
  }),
])

/** The columns for staff through platform access, who resend and revoke nothing. */
const STAFF_INVITATION_COLUMNS = column.columns(READ_COLUMNS)

/**
 * Invitations sent and not yet accepted. Mount it for owners and admins
 * only: the list endpoint is `requireRole('owner', 'admin')`, and mounting it
 * is what issues the request. A successful revoke moves focus to this heading,
 * since the row that held the button is gone. `readOnly` lists the invitations
 * with no Resend or Revoke, for staff through platform access.
 */
export function PendingInvitations({
  slug,
  myRole,
  readOnly = false,
}: {
  slug: string
  myRole: MembershipRole
  readOnly?: boolean
}) {
  const list = useListSearch(invitationsList)
  const invitations = useListQuery(list, (request) => invitationsListOptions(slug, request))
  const focus = useFocusAfter<'heading'>()
  /** Moves focus to the heading once the row that held the revoke button is gone. */
  const onRevoked = () => focus.focusAfter('heading')

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
        <InvitationsPanelScope value={{ slug, myRole, onRevoked }}>
          <DataTable
            columns={readOnly ? STAFF_INVITATION_COLUMNS : INVITATION_COLUMNS}
            query={invitations}
            label="Pending invitations"
            errorMessage={INVITATIONS_ERROR}
            getRowId={(invitation) => invitation.id}
            search={{ label: 'Search invitations', placeholder: 'Search by email' }}
            filters={[ROLE_FILTER]}
            card={(invitation) => (
              <InvitationItem
                key={invitation.id}
                slug={slug}
                invitation={invitation}
                myRole={myRole}
                readOnly={readOnly}
                onRevoked={onRevoked}
              />
            )}
            empty={<EmptyState size="compact" title="No invitations are waiting to be accepted." />}
          />
        </InvitationsPanelScope>
      </CardContent>
    </Card>
  )
}
