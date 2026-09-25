/**
 * The tenant membership roles, and the three separate permission rules the
 * backend enforces over them. Mirrors `MEMBERSHIP_ROLES`
 * (tenant.constants.ts) and `tenant.controller.ts`'s own predicates.
 *
 * They are THREE rules, not one, and collapsing any pair of them produces a
 * UI that offers actions the API refuses:
 *
 *  1. `canActorModifyTarget` — the actor->target matrix, for changing or
 *     removing an EXISTING member.
 *  2. `canChangeRoles` — role CHANGE is owner-only, because the route is
 *     gated `requireRole('owner')`. An admin passes the matrix against a
 *     viewer and is still refused a role change.
 *  3. `canActorGrantRole` — granting a role to a NEW member, who has no
 *     current role for the matrix to compare against.
 *
 * Plus `isLastOwnerBlocked`, which is not a permission at all but the
 * backend's "a tenant must keep an owner" 409.
 *
 * And the audit-log readers (`canViewActivity`, `canViewPlatformActivity`) and `isStaff`.
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
 * May `actorRole` change or remove an EXISTING member holding `targetRole`?
 *
 * | Actor \ Target | owner     | admin | manager/editor/viewer |
 * | owner          | self only | yes   | yes                   |
 * | admin          | no        | no    | yes                   |
 *
 * manager/editor/viewer never reach these endpoints; they fail closed.
 *
 * Written actor-first, where `tenant.controller.ts` writes the same table
 * target-first. The two are equivalent cell for cell — note in particular
 * that `isSelf` does NOT rescue an admin acting on their own admin
 * membership: the admin row is "no" for an admin target however `isSelf`
 * reads, which is why an admin cannot remove themselves.
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
 * May `actorRole` grant `role` to someone who is NOT yet a member?
 *
 * Separate from the matrix above: a new member has no current role to
 * compare against, and an admin who could add a new admin directly would
 * escalate past what the matrix lets them do to an existing one.
 */
export function canActorGrantRole(actorRole: MembershipRole, role: MembershipRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return role !== 'owner' && role !== 'admin'
  return false
}

/**
 * Role CHANGE is owner-only — `PATCH /tenants/:slug/members/:userId` is
 * gated `requireRole('owner')`, so an admin cannot change ANY role,
 * including a viewer's. Removal, by contrast, is owner + admin
 * (`canManageTenant`), which is why this is its own predicate rather than
 * a reading of the matrix.
 */
export function canChangeRoles(actorRole: MembershipRole): boolean {
  return actorRole === 'owner'
}

/** Tenant update, settings, member removal and invitations: owner or admin. */
export function canManageTenant(actorRole: MembershipRole): boolean {
  return actorRole === 'owner' || actorRole === 'admin'
}

/**
 * Would this action leave the tenant with no owner?
 *
 * Not a permission — the matrix has already said yes by the time this is
 * asked. The backend answers 409 ("Cannot remove the last owner" /
 * "Cannot change role: you are the last owner") for exactly one shape: an
 * owner acting on their OWN membership while they are the only owner. The
 * UI disables that control and says why, rather than letting the request
 * fail.
 *
 * Deliberately not parameterised by the NEW role. The backend exempts one
 * no-op — an owner re-submitting `{ role: 'owner' }` on themselves — but a
 * control whose only remaining option changes nothing is not worth
 * offering, so the UI disables the whole thing and this predicate stays
 * the same shape for a removal and for a role change.
 */
export function isLastOwnerBlocked({
  targetRole,
  isSelf,
  ownerCount,
}: {
  /** The target member's CURRENT role. */
  targetRole: MembershipRole
  /** Whether the actor and the target are the same user. */
  isSelf: boolean
  /** How many owners this tenant has. */
  ownerCount: number
}): boolean {
  return isSelf && targetRole === 'owner' && ownerCount <= 1
}

/**
 * The Activity tab and `GET /tenants/:slug/audit-log`: owner or admin.
 *
 * Takes the EFFECTIVE role (`useMyRole`), so a staff admin passes and a staff
 * viewer does not, which is exactly the route's `requireRole('owner', 'admin')`.
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
