/**
 * @file The members tab of a tenant: the member list with role and removal
 * controls, and, for owners and admins, the invite form and pending invitations.
 */
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
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
import { pageTitle } from '@/constants/app'
import {
  canActorModifyTarget,
  canChangeRoles,
  canManageTenant,
  isLastOwnerBlocked,
  MEMBERSHIP_ROLES,
  ROLE_LABELS,
  type MembershipRole,
} from '@/constants/roles'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { useIsMobile } from '@/hooks/use-mobile'
import { statusFrom } from '@/lib/api-error'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  dropTenantCache,
  isMemberNotFound,
  memberName,
  otherOwnerCount,
  useLeaveTenant,
  useMembers,
  useMyRole,
  useRemoveMember,
  useUpdateMemberRole,
  type TenantMember,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/tenants/$slug/members')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Members · ${params.slug}`) }] }),
  staticData: { crumb: 'Members' },
  component: TenantMembersTab,
})

/** What the Leave dialog says, for every role. */
const LEAVE_WARNING =
  'You will lose access to this tenant immediately. An owner or admin will have to invite you back.'

/**
 * What the Leave dialog says on the platform tenant. Its membership is the
 * platform role, so leaving ends staff access; an address on an auto-join
 * domain joins again as viewer at its next sign-in.
 */
const LEAVE_PLATFORM =
  'You lose staff access immediately. An owner or admin will have to invite you back, unless your address is on an auto-join domain: then you rejoin as a viewer at your next sign-in.'

/** Added for an owner or admin, the roles that can have sent invitations: leaving revokes them. */
const INVITATIONS_REVOKED_ON_LEAVE = 'Pending invitations you sent are revoked.'

/** Added on the platform tenant for an owner or admin: leaving staff also revokes, in each other tenant, what their membership there cannot grant, or everything where they have none. */
const PLATFORM_INVITATIONS_REVOKED_ON_LEAVE =
  'Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'

/** What removing a member says about the invitations they sent. */
const INVITATIONS_REVOKED_ON_REMOVE = 'Pending invitations they sent are revoked.'

/**
 * The same on the platform tenant, where the removal also revokes elsewhere
 * as leaving does, and an auto-join domain brings the address back as viewer.
 */
const PLATFORM_INVITATIONS_REVOKED_ON_REMOVE =
  'Pending invitations they sent here are revoked, and so are any they sent in other tenants for a role they can no longer grant there. If their address is on an auto-join domain, they rejoin as a viewer at their next sign-in.'

/** What a role change or removal says when its target is no longer a member. */
const MEMBER_GONE = 'That member is no longer in this tenant.'

/**
 * The toast for a failed role change or removal: `MEMBER_GONE` for a target
 * already gone, otherwise `writeFailureMessage`.
 * @param error - The failed request's error.
 * @returns The message.
 */
function memberWriteFailureMessage(error: unknown): string {
  return isMemberNotFound(error) ? MEMBER_GONE : writeFailureMessage(error)
}

/** What a leave says when the API answers 404: the membership was already gone. */
const NO_LONGER_A_MEMBER = 'You are no longer a member of this tenant.'

/** The reason the last owner's own controls are switched off. */
const LAST_OWNER_REASON = 'A tenant must always have an owner. Add another owner first.'

/**
 * What this tab says when the member list request failed. Kept apart from
 * `ROLE_ERROR`, with its own `refetch`, because the member list and the role
 * lookup are separate requests: each error names its own request, and each Try
 * again retries that request.
 */
const MEMBERS_ERROR =
  'We could not load this tenant’s members, so none are listed here. This is not a sign that it has none.'

/**
 * The role cell: a select when the actor may change this member's role, plain
 * text otherwise. That takes two predicates: `canChangeRoles`, because the
 * PATCH members route is owner-only, and `canActorModifyTarget` for which
 * target this actor may touch. Removal uses a different pair (see `MemberRow`).
 *
 * The select's accessible name includes the member's name, since there is one
 * select per row. When `isLastOwner`, this cell renders the row's one
 * last-owner explanation, with id `reasonId`, as visible text rather than a
 * tooltip: the disabled Leave button has `pointer-events: none`, so a tooltip
 * on it would never open, and Base UI's Tooltip sets no `role="tooltip"`.
 * `isLastOwner` is only true for an owner acting on their own membership,
 * which the predicates always leave as a select, so the explanation always
 * renders when it is needed.
 */
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
              onError: (error) => toast.error(memberWriteFailureMessage(error)),
            }
          )
        }}
      >
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
      {isLastOwner && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {LAST_OWNER_REASON}
        </p>
      )}
    </div>
  )
}

/**
 * The Remove control, or Leave on your own row, behind a confirm dialog.
 * Remove goes through the members route; Leave, which every role has, through
 * the caller's own membership route (`useLeaveTenant`). For the last owner it
 * is a disabled Leave button described by the row's explanation in `RoleCell`
 * (`isLastOwner` implies `isSelf`). An owner or admin leaving, and anyone
 * removing a member, is told the invitations sent are revoked, as the server
 * does; on the platform tenant, so are those beyond the sender's remaining
 * authority in other tenants. After leaving, or
 * when the API answers 404 because the membership was already gone, the page
 * navigates to `/tenants`, because the tenant's routes answer 404 to a caller
 * with neither a membership nor a platform role, and only then drops the
 * tenant's cache, so no query still mounted on the tenant refetches it. Both
 * use `mutateAsync`, because the refetch can unmount this row first and
 * `mutate`'s callbacks skip an unmounted observer.
 */
function RemoveMemberButton({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  reasonId,
  onRemoved,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
  /** Called once another member's removal has succeeded and the list has refetched. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const leaveTenant = useLeaveTenant(slug)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const name = memberName(member)
  const isPending = isSelf ? leaveTenant.isPending : removeMember.isPending
  const isPlatform = slug === PLATFORM_TENANT_SLUG

  /** Leaves, then lands on the tenant list and forgets the tenant; other failures stay here. */
  async function leave() {
    try {
      await leaveTenant.mutateAsync()
      setIsOpen(false)
      toast.success('You left this tenant.')
    } catch (error) {
      setIsOpen(false)
      if (statusFrom(error) !== 404) {
        toast.error(writeFailureMessage(error))
        return
      }
      toast.success(NO_LONGER_A_MEMBER)
    }
    await navigate({ to: '/tenants' })
    dropTenantCache(queryClient, slug)
  }

  if (isLastOwner) {
    return (
      <Button variant="outline" size="sm" disabled aria-describedby={reasonId}>
        {isSelf ? 'Leave' : 'Remove'}
      </Button>
    )
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={isPending}>
            {isSelf ? 'Leave' : 'Remove'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSelf ? (
              'Leave this tenant?'
            ) : (
              <>
                Remove <Pii>{name}</Pii>?
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSelf ? (
              <>
                {isPlatform ? LEAVE_PLATFORM : LEAVE_WARNING}
                {canManageTenant(myRole) &&
                  ` ${isPlatform ? PLATFORM_INVITATIONS_REVOKED_ON_LEAVE : INVITATIONS_REVOKED_ON_LEAVE}`}
              </>
            ) : (
              <>
                <Pii>{name}</Pii>{' '}
                {isPlatform
                  ? 'loses staff access immediately.'
                  : 'will lose access to this tenant immediately.'}{' '}
                {isPlatform
                  ? PLATFORM_INVITATIONS_REVOKED_ON_REMOVE
                  : INVITATIONS_REVOKED_ON_REMOVE}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              if (isSelf) {
                void leave()
                return
              }
              removeMember.mutateAsync(member.user.id).then(
                () => {
                  setIsOpen(false)
                  toast.success(`${name} removed.`)
                  onRemoved()
                },
                (error: unknown) => {
                  setIsOpen(false)
                  toast.error(memberWriteFailureMessage(error))
                }
              )
            }}
          >
            {isSelf ? 'Leave' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One member, as a table row or, with `asCard`, a stacked card. Removal needs
 * `canManageTenant` (owner or admin, as the DELETE members route requires)
 * and `canActorModifyTarget`, a different pair from the role-change gate in
 * `RoleCell`. `reasonId` is one id per row: the last-owner explanation renders
 * once, in the role cell, and every control the guard disables points at it;
 * your own row always has Leave.
 */
function MemberRow({
  slug,
  member,
  myRole,
  myUserId,
  otherOwners,
  onRemoved,
  asCard = false,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  myUserId: string | undefined
  /** The other owners the API counts toward the last-owner rule, besides the caller. */
  otherOwners: number
  /** Called once removing another member has succeeded. */
  onRemoved: () => void
  /**
   * Render a stacked card instead of a table row, for phones, where the
   * scrolling table puts the Actions column off-screen.
   */
  asCard?: boolean
}) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  const isLastOwner = isLastOwnerBlocked({ targetRole, isSelf, otherOwners })
  const canRemove =
    isSelf || (canManageTenant(myRole) && canActorModifyTarget(myRole, targetRole, isSelf))
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
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
      onRemoved={onRemoved}
    />
  ) : null

  if (asCard) {
    return (
      <li className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-0.5">
          <span className="font-medium">
            <Pii>{memberName(member)}</Pii>
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          </span>
          <Pii className="text-sm break-all text-muted-foreground">{member.user.email}</Pii>
        </div>
        {role}
        {remove && <div>{remove}</div>}
      </li>
    )
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Pii>{memberName(member)}</Pii>
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell>
        <Pii>{member.user.email}</Pii>
      </TableCell>
      <TableCell>{role}</TableCell>
      <TableCell className="text-right">{remove}</TableCell>
    </TableRow>
  )
}

/**
 * The members tab. Its states, in order:
 *
 * - An error, or no role: the member list and the role lookup are independent
 *   queries that can fail alone, so each failure shows its own `LoadError`
 *   retrying its own request; when both fail, both render. A failed request
 *   never shows a skeleton, which would wait forever with no retry.
 * - A skeleton while either query is pending.
 * - The empty message, only after the error branch, because a failed load and
 *   an empty tenant both give `[]` (the same order as `notifications.tsx`).
 * - Cards on a phone, because the scrolling table puts the Actions column and
 *   the last-owner explanation off-screen; otherwise the table. The layout is
 *   picked in JS with `useIsMobile`, the hook the sidebar uses, because
 *   rendering both layouts and hiding one with CSS would put two role selects
 *   per member and two elements with one `reasonId` in the DOM. The table is
 *   `min-w-2xl`, so the vendored Table's `overflow-x-auto` wrapper scrolls
 *   instead of crushing four columns.
 *
 * The invite form and pending invitations mount only for owners and admins,
 * the roles the tenant invitation routes require; `PendingInvitations` requests
 * the list only once mounted.
 */
function TenantMembersTab() {
  const { slug } = Route.useParams()
  const members = useMembers(slug)
  const { role: myRole, isPending: isRolePending, isError: isRoleError, retry } = useMyRole(slug)
  const myUserId = useAuthStore((state) => state.user?.id)
  const otherOwners = otherOwnerCount(members.data, myUserId, slug === PLATFORM_TENANT_SLUG)
  const isMobile = useIsMobile()
  const focus = useFocusAfter<'heading'>()
  const onRemoved = () => {
    focus.focusAfter('heading')
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={focus.target('heading')} tabIndex={-1} className="outline-none">
              Members
            </h2>
          </CardTitle>
          <CardDescription>Everyone with access to this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.isError || isRoleError || (!isRolePending && !myRole) ? (
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
            <p className="text-sm text-muted-foreground">
              No one has access to this tenant yet. Invite someone below.
            </p>
          ) : isMobile ? (
            <ul className="grid gap-3">
              {(members.data ?? []).map((member) => (
                <MemberRow
                  key={member.membership.id}
                  asCard
                  slug={slug}
                  member={member}
                  myRole={myRole}
                  myUserId={myUserId}
                  otherOwners={otherOwners}
                  onRemoved={onRemoved}
                />
              ))}
            </ul>
          ) : (
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
                    otherOwners={otherOwners}
                    onRemoved={onRemoved}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
          <PendingInvitations slug={slug} myRole={myRole} />
        </>
      )}
    </div>
  )
}
