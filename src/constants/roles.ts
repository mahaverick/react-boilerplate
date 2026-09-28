/**
 * @file The tenant membership roles and the permission rules the API enforces
 * over them, mirroring its tenant.constants.ts and tenant.policy.ts. Three
 * separate rules (`canActorModifyTarget`, `canChangeRoles`,
 * `canActorGrantRole`); collapsing any pair offers actions the API refuses.
 */

/** Descending authority. Mirrors MEMBERSHIP_ROLES on the server. */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'manager', 'editor', 'viewer'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

/** The invite form's default role. */
export const DEFAULT_MEMBER_ROLE: MembershipRole = 'viewer'

/** A reader-facing label for each role, for selects and badges. */
export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  editor: 'Editor',
  viewer: 'Viewer',
}

/**
 * May `actorRole` change or remove an existing member holding `targetRole`?
 *
 * | Actor \ Target | owner     | admin | manager/editor/viewer |
 * | owner          | self only | yes   | yes                   |
 * | admin          | no        | no    | yes                   |
 *
 * Any other actor fails closed. `isSelf` does not help an admin acting on
 * their own admin membership, so an admin cannot remove themselves.
 */
export function canActorModifyTarget(
  actorRole: MembershipRole,
  targetRole: MembershipRole,
  isSelf: boolean
): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner' || isSelf
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin'
  return false
}

/**
 * May `actorRole` grant `role` to someone who is not yet a member? Separate
 * from the matrix: a new member has no current role, and an admin who could
 * add an admin would escalate past what the matrix allows.
 */
export function canActorGrantRole(actorRole: MembershipRole, role: MembershipRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return role !== 'owner' && role !== 'admin'
  return false
}

/**
 * Role change is owner-only: `PATCH /tenants/:slug/members/:userId` is gated
 * `requireRole('owner')`, so an admin who passes the matrix against a viewer
 * is still refused. Removal is owner or admin (`canManageTenant`).
 */
export function canChangeRoles(actorRole: MembershipRole): boolean {
  return actorRole === 'owner'
}

/** Tenant update, settings, member removal and invitations: owner or admin. */
export function canManageTenant(actorRole: MembershipRole): boolean {
  return actorRole === 'owner' || actorRole === 'admin'
}

/**
 * Would this action leave the tenant with no owner? Not a permission: the API
 * answers 409 ("Cannot remove the last owner" / "Cannot change role: you are
 * the last owner") when an owner acts on their own membership as the only
 * owner, and the UI disables that control and says why instead.
 *
 * Not parameterised by the new role: the API exempts an owner re-submitting
 * `{ role: 'owner' }`, but a control whose only option changes nothing is not
 * worth offering, so one shape serves removal and role change.
 */
export function isLastOwnerBlocked({
  targetRole,
  isSelf,
  ownerCount,
}: {
  /** The target member's current role. */
  targetRole: MembershipRole
  /** Whether the actor and the target are the same user. */
  isSelf: boolean
  /** How many owners this tenant has. */
  ownerCount: number
}): boolean {
  return isSelf && targetRole === 'owner' && ownerCount <= 1
}

/**
 * The Activity tab and `GET /tenants/:slug/audit-log`: owner or admin. Takes
 * the effective role (`useMyRole`), so a staff admin passes and a staff viewer
 * does not, as the route's `requireRole('owner', 'admin')` does.
 */
export function canViewActivity(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Whether the signed-in user is platform staff: any role in the platform
 * tenant. `undefined` is a user object without the field, and is not staff.
 */
export function isStaff(platformRole: MembershipRole | null | undefined): boolean {
  return platformRole !== null && platformRole !== undefined
}

/** `GET /platform/audit-log` and its page: platform owner or admin. */
export function canViewPlatformActivity(platformRole: MembershipRole | null | undefined): boolean {
  return platformRole === 'owner' || platformRole === 'admin'
}
