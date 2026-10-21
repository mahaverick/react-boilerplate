/**
 * @file The members tab of a tenant: the member list with role and removal
 * controls, and, for owners and admins, the invite form and pending invitations.
 */
import { IconUsers } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, useRef, useState } from 'react'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { ROLE_FILTER } from '@/components/features/tenant/role-filter'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { TableRowsSkeleton } from '@/components/shared/section-skeleton'
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
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { toast } from '@/lib/toast'
import { writeFailureMessage } from '@/lib/write-failure'
import { analyticsKey } from '@/observability/telemetry'
import {
  dropTenantCache,
  isMemberNotFound,
  memberName,
  membersList,
  membersListOptions,
  ownersBesides,
  ownersQueryOptions,
  tenantQueryOptions,
  useLeaveTenant,
  useMyRole,
  useRemoveMember,
  useUpdateMemberRole,
  type TenantMember,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

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

/**
 * What the members card says to a staff owner or admin who reached a customer
 * tenant through platform access: express refuses their member and invitation
 * writes here without a staff reason, which only the staff console sends. A
 * staff viewer is told nothing, since their role allows those writes nowhere.
 */
const STAFF_VIEW = 'You’re viewing this tenant as staff. Make changes from the staff console.'

/** What a role change or removal says when its target is no longer a member. */
const MEMBER_GONE = 'That member is no longer in this tenant. We refreshed the list.'

/**
 * The toast for a failed role change or removal: `MEMBER_GONE` for a target
 * already gone, otherwise `writeFailureMessage`.
 * @param error - The failed request's error.
 * @returns The message.
 */
function memberWriteFailureMessage(error: unknown): string {
  return isMemberNotFound(error) ? MEMBER_GONE : writeFailureMessage(error)
}

/**
 * The leave toast. It names the tenant, since it shows on the tenant list,
 * where "this tenant" names nothing; the name comes from the tenant read the
 * page already holds.
 * @param tenantName - The tenant's name, when the cache has it.
 */
const leftTenant = (tenantName: string | undefined) => `You left ${tenantName ?? 'this tenant'}.`

/**
 * What a leave says when the API answers 404: the membership was already gone.
 * @param tenantName - The tenant's name, when the cache has it.
 */
const noLongerMember = (tenantName: string | undefined) =>
  `You’re no longer a member of ${tenantName ?? 'this tenant'}.`

/** The reason the last owner's own controls are switched off. */
const LAST_OWNER_REASON = 'A tenant must always have an owner. Add another owner first.'

/**
 * What this tab says when the member list request failed. Kept apart from
 * `ROLE_ERROR`, with its own `refetch`, because the member list and the role
 * lookup are separate requests: each error names its own request, and each Try
 * again retries that request.
 */
const MEMBERS_ERROR =
  'We couldn’t load this tenant’s members, so none are listed. Try again to load them.'

/**
 * The role cell: a select when the actor may change this member's role, plain
 * text otherwise. That takes two predicates: `canChangeRoles`, because the
 * PATCH members route is owner-only, and `canActorModifyTarget` for which
 * target this actor may touch. Removal uses a different pair (see `memberControls`).
 *
 * The select's accessible name includes the member's name, since there is one
 * select per row. When `isLastOwner`, this cell renders the row's one
 * last-owner explanation, with id `reasonId`, as visible text rather than a
 * tooltip: the disabled Leave button has `pointer-events: none`, so a tooltip
 * on it would never open, and Base UI's Tooltip sets no `role="tooltip"`.
 * `isLastOwner` is only true for an owner acting on their own membership,
 * which the predicates always leave as a select, so the explanation always
 * renders when it is needed. The change uses `mutateAsync`, as removal does: a
 * member already gone refetches the list, which can unmount this cell before
 * `mutate`'s per-call callbacks run, and `onGone` moves focus on.
 */
function RoleCell({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  ownersPending,
  reasonId,
  onGone,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The owner count is not known yet (loading or failed): the select stays off, with no reason claimed. */
  ownersPending: boolean
  /** The row's one last-owner explanation, which this cell renders. */
  reasonId: string
  /** Called once a role change found the member already gone and the list has refetched. */
  onGone: () => void
}) {
  const updateRole = useUpdateMemberRole(slug)
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const targetRole = member.membership.role
  const name = memberName(member)

  if (!canChangeRoles(myRole) || !canActorModifyTarget(myRole, targetRole, isSelf)) {
    return <span>{ROLE_LABELS[targetRole]}</span>
  }

  return (
    <div className="grid gap-1">
      <Select
        value={targetRole}
        // The refused change is not pending while its step-up waits, so the select stays off.
        disabled={isLastOwner || ownersPending || updateRole.isPending || stepping}
        onValueChange={(value: string | null) => {
          if (value === null || value === targetRole) return
          stepUp
            .run(() =>
              updateRole.mutateAsync({ userId: member.user.id, role: value as MembershipRole })
            )
            .then(
              () => {
                toast.success(`${name} is now ${ROLE_LABELS[value as MembershipRole]}.`)
              },
              (error: unknown) => {
                toast.error(memberWriteFailureMessage(error))
                if (isMemberNotFound(error)) onGone()
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
 * authority in other tenants. After leaving, or when the API answers 404
 * because the membership was already gone, the page navigates to `/tenants`,
 * because the tenant's routes answer 404 to a caller with neither a
 * membership nor a platform role, and only then drops the tenant's cache, so
 * no query still mounted on the tenant refetches it. Both use `mutateAsync`,
 * because the refetch can unmount this row first and `mutate`'s callbacks
 * skip an unmounted observer.
 */
function RemoveMemberButton({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  ownersPending,
  reasonId,
  onRemoved,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The owner count is not known yet (loading or failed): the control stays off, with no reason claimed. */
  ownersPending: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
  /** Called once another member's removal has succeeded, or found them already gone, and the list has refetched. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const leaveTenant = useLeaveTenant(slug)
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const name = memberName(member)
  const isPending = isSelf ? leaveTenant.isPending : removeMember.isPending
  const isPlatform = slug === PLATFORM_TENANT_SLUG

  /** Leaves, then lands on the tenant list and forgets the tenant; other failures stay here. */
  async function leave() {
    const tenantName = queryClient.getQueryData(tenantQueryOptions(slug).queryKey)?.name
    try {
      await stepUp.run(() => leaveTenant.mutateAsync())
      setIsOpen(false)
      toast.success(leftTenant(tenantName))
    } catch (error) {
      setIsOpen(false)
      if (statusFrom(error) !== 404) {
        toast.error(writeFailureMessage(error))
        return
      }
      toast.success(noLongerMember(tenantName))
    }
    await navigate({ to: '/tenants' })
    dropTenantCache(queryClient, slug)
  }

  if (isLastOwner || ownersPending) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-describedby={isLastOwner ? reasonId : undefined}
      >
        {isSelf ? 'Leave' : 'Remove'}
      </Button>
    )
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        // While the write waits on "Confirm it's you", Escape and outside presses belong to it.
        if (!next && stepping) return
        setIsOpen(next)
      }}
    >
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
            disabled={isPending || stepping}
            onClick={() => {
              if (isSelf) {
                void leave()
                return
              }
              stepUp
                .run(() => removeMember.mutateAsync(member.user.id))
                .then(
                  () => {
                    setIsOpen(false)
                    toast.success(`${name} removed.`)
                    onRemoved()
                  },
                  (error: unknown) => {
                    setIsOpen(false)
                    toast.error(memberWriteFailureMessage(error))
                    if (isMemberNotFound(error)) onRemoved()
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

/** What a member's cells and card are built from. */
interface MemberRowContext {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  myUserId: string | undefined
  /** The other owners the API counts toward the last-owner rule, besides the caller. */
  otherOwners: number
  /** Whether the owners read has landed. An owner's own controls stay off until it has, since the count is not known. */
  ownersKnown: boolean
  /** Staff through platform access: the row offers no role change and no removal. */
  readOnly: boolean
  /** Called once removing another member has succeeded, or found them already gone. */
  onRemoved: () => void
}

/**
 * The rules one member's controls follow. Removal needs `canManageTenant`
 * (owner or admin, as the DELETE members route requires) and
 * `canActorModifyTarget`, a different pair from the role-change gate in
 * `RoleCell`. `reasonId` is one id per row: the last-owner explanation renders
 * once, in the role cell, and every control the guard disables points at it;
 * your own row always has Leave.
 * @param context - The member and the caller.
 */
function memberControls({
  member,
  myRole,
  myUserId,
  otherOwners,
  ownersKnown,
  readOnly,
}: MemberRowContext) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  // Only an owner acting on their own owner row depends on the owner count.
  const countMatters = isSelf && targetRole === 'owner'
  return {
    targetRole,
    isSelf,
    isLastOwner: ownersKnown && isLastOwnerBlocked({ targetRole, isSelf, otherOwners }),
    ownersPending: countMatters && !ownersKnown,
    canRemove:
      !readOnly &&
      (isSelf || (canManageTenant(myRole) && canActorModifyTarget(myRole, targetRole, isSelf))),
    reasonId: `last-owner-${member.membership.id}`,
  }
}

/** One member's role: a select when the caller may change it, text otherwise. */
function MemberRole(context: MemberRowContext) {
  const { slug, member, myRole, onRemoved, readOnly } = context
  const { targetRole, isSelf, isLastOwner, ownersPending, reasonId } = memberControls(context)
  if (readOnly) return <span>{ROLE_LABELS[targetRole]}</span>
  return (
    <RoleCell
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      ownersPending={ownersPending}
      reasonId={reasonId}
      onGone={onRemoved}
    />
  )
}

/** One member's Remove (or Leave) control; nothing when the caller has none. */
function MemberActions(context: MemberRowContext) {
  const { slug, member, myRole, onRemoved } = context
  const { isSelf, isLastOwner, ownersPending, canRemove, reasonId } = memberControls(context)
  if (!canRemove) return null
  return (
    <RemoveMemberButton
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      ownersPending={ownersPending}
      reasonId={reasonId}
      onRemoved={onRemoved}
    />
  )
}

/**
 * One member as a stacked card, for phones, where the scrolling table puts
 * the Actions column off-screen. The role and Remove controls are the table
 * cells' own.
 */
function MemberCard(context: MemberRowContext) {
  const { member, myUserId } = context
  return (
    <Item variant="outline" role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          <span className="flex flex-wrap items-center gap-2">
            <Pii>{memberName(member)}</Pii>
            {member.user.id === myUserId && (
              <span className="text-xs font-normal text-muted-foreground">(you)</span>
            )}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-all">
          <Pii>{member.user.email}</Pii>
        </ItemDescription>
      </ItemContent>
      <ItemFooter className="flex-wrap justify-start">
        <MemberRole {...context} />
        <MemberActions {...context} />
      </ItemFooter>
    </Item>
  )
}

/** What the panel hands its cells: the caller and the tenant, which every row's controls read. */
type MembersPanelContext = Omit<MemberRowContext, 'member'>

const MembersPanelScope = createContext<MembersPanelContext | null>(null)

/**
 * A member's row context: the panel's, with the row's member. The columns are
 * module-level, so a cell reads what changes between renders (the caller, the
 * owner count, the removal callback) from context, and re-renders in place
 * rather than remounting with its dialog state.
 * @param member - The row's member.
 */
function useMemberRowContext(member: TenantMember): MemberRowContext {
  const panel = useContext(MembersPanelScope)
  if (panel === null) throw new Error('A member cell renders inside the members panel.')
  return { ...panel, member }
}

/** The name cell: the full name, or a dash for a member with none, and "(you)" on the caller's own row. */
function MemberNameCell({ member }: { member: TenantMember }) {
  const { myUserId } = useMemberRowContext(member)
  const name = fullName(member.user)
  return (
    <span className="font-medium">
      {name === null ? <span className="text-muted-foreground">—</span> : <Pii>{name}</Pii>}
      {member.user.id === myUserId && (
        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
      )}
    </span>
  )
}

/** The role cell of the table. */
function MemberRoleCell({ member }: { member: TenantMember }) {
  return <MemberRole {...useMemberRowContext(member)} />
}

/** The actions cell of the table. */
function MemberActionsCell({ member }: { member: TenantMember }) {
  return <MemberActions {...useMemberRowContext(member)} />
}

const column = createColumnHelper<DataTableFeatures, TenantMember>()

/** The name, email and role columns every viewer sees. */
const READ_COLUMNS = [
  column.accessor((member) => fullName(member.user) ?? '', {
    id: 'name',
    header: 'Name',
    meta: { sorts: ['name'], sortName: analyticsKey('name') },
    cell: ({ row }) => <MemberNameCell member={row.original} />,
  }),
  column.accessor((member) => member.user.email, {
    id: 'email',
    header: 'Email',
    meta: { sorts: ['email'], sortName: analyticsKey('email') },
    cell: ({ getValue }) => <Pii className="break-all">{getValue()}</Pii>,
  }),
  column.accessor((member) => member.membership.role, {
    id: 'role',
    header: 'Role',
    // The cell holds the row's controls and the last-owner explanation they point at.
    enableHiding: false,
    meta: { sorts: ['role'], sortName: analyticsKey('role') },
    cell: ({ row }) => <MemberRoleCell member={row.original} />,
  }),
]

/** The columns of a caller who can act on members: the read columns, then Actions. */
const MEMBER_COLUMNS = column.columns([
  ...READ_COLUMNS,
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true, className: 'text-right' },
    cell: ({ row }) => <MemberActionsCell member={row.original} />,
  }),
])

/** The columns for staff through platform access, who act on no member. */
const STAFF_MEMBER_COLUMNS = column.columns(READ_COLUMNS)

/**
 * The members tab. Its states, in order:
 *
 * - No role: the role lookup is its own request and can fail alone, so its
 *   failure shows a `LoadError` retrying that request, and a skeleton shows
 *   while it is pending. A failed request never shows a skeleton, which would
 *   wait forever with no retry.
 * - Then `DataTable`'s: its own skeleton, load error with Try again, empty
 *   message (only for a list that answered with no rows) and the rows, as a
 *   table or, on a phone, as member cards. A failed owners read, which the
 *   last-owner rule needs, shows its own `LoadError` above the list and keeps
 *   the last owner's controls locked.
 *
 * The invite form and pending invitations mount only for owners and admins,
 * the roles the tenant invitation routes require; `PendingInvitations` requests
 * the list only once mounted.
 */
export function TenantMembersPanel({ slug }: { slug: string }) {
  const list = useListSearch(membersList)
  const members = useListQuery(list, (request) => membersListOptions(slug, request))
  const {
    role: myRole,
    access,
    isPending: isRolePending,
    isError: isRoleError,
    retry,
  } = useMyRole(slug)
  const isStaffView = access === 'platform'
  // Only an owner can act on an owner row (remove, demote or leave as one), so only an owner needs the count.
  const owners = useQuery({
    ...ownersQueryOptions(slug),
    enabled: myRole === 'owner' && !isStaffView,
  })
  const myUserId = useAuthStore((state) => state.user?.id)
  const otherOwners = ownersBesides(owners.data, myUserId, slug === PLATFORM_TENANT_SLUG)
  const focus = useFocusAfter<'heading'>()
  const inviteCard = useRef<HTMLDivElement>(null)

  /** Brings the invite form into view and puts the cursor in its first field. */
  const showInviteForm = () => {
    inviteCard.current?.scrollIntoView({ block: 'center' })
    inviteCard.current?.querySelector('input')?.focus()
  }

  /** Moves focus to the heading once the row that held the focused control is gone. */
  const onRemoved = () => {
    focus.focusAfter('heading')
  }

  /** What the cells read, once the caller's role is known. */
  const panel: MembersPanelContext | null =
    myRole && !isRoleError
      ? {
          slug,
          myRole,
          myUserId,
          otherOwners,
          ownersKnown: owners.isSuccess,
          readOnly: isStaffView,
          onRemoved,
        }
      : null

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
          {isStaffView && myRole && canManageTenant(myRole) && (
            <p className="text-sm text-muted-foreground">{STAFF_VIEW}</p>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {panel === null && (isRoleError || !isRolePending) ? (
            <LoadError message={ROLE_ERROR} onRetry={retry} />
          ) : panel === null ? (
            <TableRowsSkeleton rows={4} columns={isStaffView ? 3 : 4} />
          ) : (
            <>
              {owners.isError && (
                <LoadError
                  message="Owners didn’t load, so owner changes are locked."
                  onRetry={() => void owners.refetch()}
                />
              )}
              <MembersPanelScope value={panel}>
                <DataTable
                  columns={isStaffView ? STAFF_MEMBER_COLUMNS : MEMBER_COLUMNS}
                  query={members}
                  label="Members"
                  errorMessage={MEMBERS_ERROR}
                  getRowId={(member) => member.membership.id}
                  search={{ label: 'Search members', placeholder: 'Search by name or email' }}
                  filters={[ROLE_FILTER]}
                  card={(member) => (
                    <MemberCard key={member.membership.id} {...panel} member={member} />
                  )}
                  empty={
                    <EmptyState
                      icon={<IconUsers aria-hidden="true" />}
                      title="No one has access to this tenant yet."
                      description={!isStaffView ? 'Invite someone below.' : undefined}
                      action={
                        canManageTenant(panel.myRole) && !isStaffView ? (
                          <Button variant="outline" size="sm" onClick={showInviteForm}>
                            Invite someone
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
              </MembersPanelScope>
            </>
          )}
        </CardContent>
      </Card>

      {myRole && canManageTenant(myRole) && isStaffView && (
        <PendingInvitations slug={slug} myRole={myRole} readOnly />
      )}
      {myRole && canManageTenant(myRole) && !isStaffView && (
        <>
          <Card ref={inviteCard}>
            <CardHeader>
              <CardTitle>
                <h2>Invite a member</h2>
              </CardTitle>
              <CardDescription>
                We email them an invitation that expires in 3 days. Someone new joins in one click.
                Someone with an account gets a sign-in link to confirm.
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
