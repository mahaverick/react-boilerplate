import type { AuditAction } from '@/constants/audit-actions'
import type { MembershipRole } from '@/constants/roles'

export interface ApiSuccess<T> {
  success: true
  message: string
  statusCode: number
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  statusCode: number
  /** Stable machine-readable discriminator, e.g. ACCESS_TOKEN_EXPIRED. */
  code?: string
  /** Field-level validator detail, shaped by the backend's Zod flatten. */
  errors?: Record<string, string[]>
  requestId: string
}

/**
 * `toPublicUser` on the server (AuthenticatedUser plus createdAt), plus the
 * caller's role in the platform tenant. `platformRole` is `null` for everyone
 * who is not staff; test it with `isStaff`, never by truthiness of a copy.
 */
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
  platformRole: MembershipRole | null
}

/** How the caller reached a tenant: as one of its members, or as platform staff. */
export type TenantAccess = 'member' | 'platform'

export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'

/**
 * `invitedBy` on a pending-invitation row, or `null` once the inviter's
 * account is gone (the column is `on delete set null`).
 */
export interface InvitationInviter {
  id: string
  firstName: string | null
  lastName: string | null
}

/**
 * One row of `GET /tenants/:slug/invitations`. The server never sends the
 * token or its hash, so nothing here can be used to accept the invitation.
 */
export interface TenantInvitation {
  id: string
  email: string
  role: MembershipRole
  invitedBy: InvitationInviter | null
  expiresAt: string
  createdAt: string
}

/** `POST /invitations/preview` with `{ token }`: what an invite link opens onto. */
export interface InvitationPreview {
  tenant: { name: string; slug: string }
  role: MembershipRole
  invitedBy: { firstName: string | null; lastName: string | null } | null
  /** The address the invitation was sent to. */
  email: string
}

/** `POST /invitations/accept`: the tenant the caller is now a member of. */
export interface AcceptedInvitation {
  tenant: { name: string; slug: string }
  /** The caller's CURRENT role there: an existing member keeps theirs, so not necessarily the invited one. */
  role: MembershipRole
}

/** 409 on invite: that address already belongs to a member of this tenant. */
export const ALREADY_MEMBER = 'already_member'

/**
 * 409 on invite: two invitations for the same address raced, and this one
 * lost. Retrying after a refresh is safe.
 */
export const INVITATION_CONFLICT = 'invitation_conflict'

/** 404 on resend and revoke: the invitation stopped being pending meanwhile. */
export const INVITATION_NOT_FOUND = 'invitation_not_found'

/** 404 on preview and accept: invalid, expired, revoked or already used. */
export const INVITATION_INVALID = 'invitation_invalid'

/** 403 on accept: the signed-in account's email is not the invited one. */
export const INVITATION_EMAIL_MISMATCH = 'invitation_email_mismatch'

/** 403 on accept: the signed-in account is the invited one, but its email is unverified. */
export const INVITATION_EMAIL_UNVERIFIED = 'invitation_email_unverified'

/** One row of `GET /platform/tenants`: staff search across every tenant. */
export interface PlatformTenantRow {
  id: string
  name: string
  slug: string
  lifecycleState: 'active' | 'suspended' | 'archived'
  memberCount: number
  createdAt: string
}

/** A keyset page of `GET /platform/tenants`. `nextCursor` is opaque; send it back as-is. */
export interface PlatformTenantPage {
  tenants: PlatformTenantRow[]
  nextCursor: string | null
}

/** How an audit entry's actor reached the tenant. `system` is a script, with no actor. */
export type AuditAccess = 'member' | 'platform' | 'system'

/** The actor on an audit entry. Staff are shown with their email too. */
export interface AuditActor {
  id: string
  name: string
  email: string
}

export interface AuditTarget {
  type: 'tenant' | 'membership' | 'invitation' | 'settings' | 'user'
  id: string
}

/** One row of a tenant's `GET /tenants/:slug/audit-log`. */
export interface AuditEntry {
  id: string
  /** ISO 8601, millisecond precision. */
  occurredAt: string
  action: AuditAction
  access: AuditAccess
  actor: AuditActor | null
  target: AuditTarget | null
  /** Per-action; never a full email address or a token. */
  metadata: Record<string, unknown>
}

/** One row of `GET /platform/audit-log`: the same entry, plus where it happened. */
export interface PlatformAuditEntry extends AuditEntry {
  tenant: { id: string; name: string; slug: string }
}

/** A keyset page of either audit log. `nextCursor` is opaque. */
export interface AuditPage<T extends AuditEntry> {
  entries: T[]
  nextCursor: string | null
}
