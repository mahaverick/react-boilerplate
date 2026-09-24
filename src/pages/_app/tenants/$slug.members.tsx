import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  canActorModifyTarget,
  canChangeRoles,
  canManageTenant,
  isLastOwnerBlocked,
  MEMBERSHIP_ROLES,
  ROLE_LABELS,
  type MembershipRole,
} from '@/constants/roles'
import { useIsMobile } from '@/hooks/use-mobile'
import { messageFrom } from '@/lib/api-error'
import {
  memberName,
  ownerCount,
  useMembers,
  useMyRole,
  useRemoveMember,
  useUpdateMemberRole,
  type TenantMember,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/tenants/$slug/members')({
  staticData: { crumb: 'Members' },
  component: TenantMembersTab,
})

/** The reason the last owner's own controls are switched off. */
const LAST_OWNER_REASON = 'A tenant must always have an owner. Add another owner first.'

/**
 * What this tab says when the MEMBER LIST itself failed, as opposed to the
 * role lookup.
 *
 * Its own message and, below, its own `refetch`, because the two are separate
 * requests. Folding them into `ROLE_ERROR` + `useMyRole`'s retry — which this
 * tab did until it was measured — produced the worst of both: a members 500
 * was reported as "we could not load your role in this tenant", about a query
 * that had SUCCEEDED, under a Try again that refetched the tenant LIST and
 * issued no further members request at all. A retry that cannot retry is
 * worse than no retry, because `LoadError` promises the reader their next
 * move is in front of them.
 */
const MEMBERS_ERROR =
  'We could not load this tenant’s members, so none are listed here. This is not a sign that it has none.'

/** The role cell: a select for an owner, plain text for everyone else. */
function RoleCell({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  reasonId,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, which this cell renders. */
  reasonId: string
}) {
  const updateRole = useUpdateMemberRole(slug)
  const targetRole = member.membership.role
  const name = memberName(member)

  // TWO predicates, deliberately. `canChangeRoles` is the route's own gate —
  // PATCH /tenants/:slug/members/:userId is `requireRole('owner')`, so an
  // admin cannot change ANY role, a viewer's included. The matrix then says
  // which TARGET this actor may touch. Removal uses a different pair, which
  // is exactly why these are not one function.
  if (!canChangeRoles(myRole) || !canActorModifyTarget(myRole, targetRole, isSelf)) {
    return <span>{ROLE_LABELS[targetRole]}</span>
  }

  return (
    <div className="grid gap-1">
      <Select
        value={targetRole}
        disabled={isLastOwner || updateRole.isPending}
        onValueChange={(value: string | null) => {
          if (value === null || value === targetRole) return
          updateRole.mutate(
            { userId: member.user.id, role: value as MembershipRole },
            {
              onSuccess: () =>
                toast.success(`${name} is now ${ROLE_LABELS[value as MembershipRole]}.`),
              onError: (error) => toast.error(messageFrom(error)),
            }
          )
        }}
      >
        {/* Icon-free and label-free in the table, so the accessible name has
            to name the ROW too — there is one of these per member. */}
        <SelectTrigger
          aria-label={`Role for ${name}`}
          aria-describedby={isLastOwner ? reasonId : undefined}
          className="w-36"
        >
          <SelectValue>
            {(value: string) => ROLE_LABELS[value as MembershipRole] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MEMBERSHIP_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The row's ONE copy of the explanation, rendered here because the
          role select is the first control it applies to; the Leave button
          points at this same id rather than repeating the sentence.
          Visible text, not a tooltip: a disabled control receives no pointer
          events, so a tooltip on it never opens — and Base UI's Tooltip emits
          no role="tooltip" for a screen reader either.

          Always rendered when `isLastOwner`, because that implies an owner
          acting on their own membership, which is exactly the case where the
          matrix above leaves this select in place. */}
      {isLastOwner && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {LAST_OWNER_REASON}
        </p>
      )}
    </div>
  )
}

function RemoveMemberButton({
  slug,
  member,
  isSelf,
  isLastOwner,
  reasonId,
}: {
  slug: string
  member: TenantMember
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
}) {
  const removeMember = useRemoveMember(slug)
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const name = memberName(member)

  if (isLastOwner) {
    // Described BY the row's existing explanation, not by a second copy of
    // it: an `id` reference reaches across cells, and the reader does not
    // need the same sentence told to them twice in one row.
    return (
      <Button variant="outline" size="sm" disabled aria-describedby={reasonId}>
        {/* `isLastOwner` is only ever true when `isSelf` is, so this reads
            "Leave" — the same word the enabled control uses. */}
        {isSelf ? 'Leave' : 'Remove'}
      </Button>
    )
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={removeMember.isPending}>
            {isSelf ? 'Leave' : 'Remove'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isSelf ? 'Leave this tenant?' : `Remove ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {isSelf
              ? 'You will lose access to this tenant immediately. An owner or admin will have to invite you back.'
              : `${name} will lose access to this tenant immediately.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={removeMember.isPending}
            onClick={() => {
              removeMember.mutate(member.user.id, {
                onSuccess: () => {
                  setIsOpen(false)
                  toast.success(isSelf ? 'You left this tenant.' : `${name} removed.`)
                  // Removing YOURSELF makes every request on this page a 404
                  // a moment later — this tenant is no longer one of yours.
                  // Leave before that happens rather than after. `void`
                  // because react-query's callback wants a void return, not a
                  // promise it would never await.
                  if (isSelf) void navigate({ to: '/tenants' })
                },
                onError: (error) => {
                  setIsOpen(false)
                  toast.error(messageFrom(error))
                },
              })
            }}
          >
            {isSelf ? 'Leave' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function MemberRow({
  slug,
  member,
  myRole,
  myUserId,
  owners,
  asCard = false,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  myUserId: string | undefined
  owners: number
  /** Stacked card instead of a table row. See the list below for why. */
  asCard?: boolean
}) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  const isLastOwner = isLastOwnerBlocked({ targetRole, isSelf, ownerCount: owners })
  // Removal is owner+admin (`canManageTenant`) narrowed by the matrix — a
  // different pair from the role-change gate in RoleCell.
  const canRemove = canManageTenant(myRole) && canActorModifyTarget(myRole, targetRole, isSelf)
  // One id per ROW: the explanation is rendered once, by the role cell, and
  // every control the guard disables points at it.
  const reasonId = `last-owner-${member.membership.id}`

  const role = (
    <RoleCell
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
    />
  )
  const remove = canRemove ? (
    <RemoveMemberButton
      slug={slug}
      member={member}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
    />
  ) : null

  if (asCard) {
    return (
      <li className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-0.5">
          <span className="font-medium">
            {memberName(member)}
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          </span>
          <span className="text-sm break-all text-muted-foreground">{member.user.email}</span>
        </div>
        {role}
        {remove && <div>{remove}</div>}
      </li>
    )
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {memberName(member)}
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell>{member.user.email}</TableCell>
      <TableCell>{role}</TableCell>
      <TableCell className="text-right">{remove}</TableCell>
    </TableRow>
  )
}

function TenantMembersTab() {
  const { slug } = Route.useParams()
  const members = useMembers(slug)
  const { role: myRole, isPending: isRolePending, isError: isRoleError, retry } = useMyRole(slug)
  const myUserId = useAuthStore((state) => state.user?.id)
  const owners = ownerCount(members.data)
  const isMobile = useIsMobile()

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Members</h2>
          </CardTitle>
          <CardDescription>Everyone with access to this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.isError || isRoleError || (!isRolePending && !myRole) ? (
            // NOT a skeleton. The request has already failed, so nothing is on
            // its way — a skeleton here would spin for ever with no error and
            // no retry.
            //
            // STACKED, not chained: these are two independent queries and
            // either can fail alone. Picking one branch would mean picking a
            // winner whose retry cannot fix the loser, which is precisely the
            // defect this replaces. When both fail the reader gets both
            // sentences and both controls; in the ordinary case only one of
            // these renders.
            <div className="grid gap-3">
              {members.isError && (
                <LoadError message={MEMBERS_ERROR} onRetry={() => void members.refetch()} />
              )}
              {(isRoleError || (!isRolePending && !myRole)) && (
                <LoadError message={ROLE_ERROR} onRetry={retry} />
              )}
            </div>
          ) : members.isPending || isRolePending || !myRole ? (
            <div className="grid gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (members.data ?? []).length === 0 ? (
            // AFTER the error branch, never before it: `[]` is what a failed
            // load and an empty tenant both look like, and saying "no one has
            // access" on the strength of a request that never answered is a
            // statement about the tenant we have not earned. Same ordering,
            // and the same reason, as `notifications.tsx`.
            //
            // A bare `Name / Email / Role / Actions` header over nothing was
            // what rendered here before; the visual gate caught it.
            <p className="text-sm text-muted-foreground">
              No one has access to this tenant yet. Invite someone below.
            </p>
          ) : isMobile ? (
            // CARDS ON A PHONE. The table below is `min-w-2xl` so it scrolls
            // rather than crushing four columns into 320px, and that scroll
            // works — but it put the Actions column and the last-owner
            // explanation past the right edge, where a reader has no reason
            // to look. Measured at 390px: scrollWidth 672 against clientWidth
            // 326.
            //
            // Chosen in JS rather than with `hidden md:table` / `md:hidden`
            // because a CSS pair renders BOTH paths into the DOM: two role
            // selects per member, two copies of one `reasonId`, and a
            // duplicate-id accessibility failure that looks like a
            // regression. `useIsMobile` is the same hook the sidebar sheet
            // uses, so "phone" means one thing across the app.
            <ul className="grid gap-3">
              {(members.data ?? []).map((member) => (
                <MemberRow
                  key={member.membership.id}
                  asCard
                  slug={slug}
                  member={member}
                  myRole={myRole}
                  myUserId={myUserId}
                  owners={owners}
                />
              ))}
            </ul>
          ) : (
            // The vendored Table already wraps itself in an overflow-x-auto
            // container; `min-w-2xl` is what makes that container actually
            // scroll on a phone instead of crushing four columns into 320px.
            <Table className="min-w-2xl">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.data ?? []).map((member) => (
                  <MemberRow
                    key={member.membership.id}
                    slug={slug}
                    member={member}
                    myRole={myRole}
                    myUserId={myUserId}
                    owners={owners}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Owner and admin only: both invitation routes are
          `requireRole('owner', 'admin')`, and PendingInvitations issues its
          request only once mounted. */}
      {myRole && canManageTenant(myRole) && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Invite a member</h2>
              </CardTitle>
              <CardDescription>
                We email them a link to join. Someone without an account can create one with that
                address, then open the link again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm slug={slug} myRole={myRole} />
            </CardContent>
          </Card>
          <PendingInvitations slug={slug} />
        </>
      )}
    </div>
  )
}
