import type { AuditAction } from '@/constants/audit-action-names'
import type { MembershipRole } from '@/constants/roles'

/** The envelope of a successful API response; `data` carries the payload. */
export interface ApiSuccess<T> {
  success: true
  message: string
  statusCode: number
  data: T
}

/** The body of an error response: branch on `code` or `statusCode`, and show `message` to the person. */
export interface ApiErrorBody {
  success: false
  message: string
  statusCode: number
  /** Stable machine-readable discriminator, e.g. `ACCESS_TOKEN_EXPIRED`. */
  code?: string
  /** Field-level validator detail: a message array per invalid field, plus `formErrors` for an issue that names no single field. */
  errors?: Record<string, string[]>
  requestId: string
}

/**
 * The server's `ProfileResponse`: the user's public fields plus their role in
 * the platform tenant. `platformRole` is `null` for everyone who is not staff;
 * test it with `isStaff`, never by truthiness of a copy.
 */
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
  platformRole: MembershipRole | null
  /** True when the user turned the profile's "Share usage analytics" switch off. Stops browser analytics only. */
  analyticsOptOut: boolean
}

/** How the caller reached a tenant: as one of its members, or as platform staff. */
export type TenantAccess = 'member' | 'platform'

/** `code` on the 401 for an expired access token, which the interceptor answers by refreshing the session and replaying the request. */
export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'

/**
 * 401 on a destructive staff route whose session last authenticated too long
 * ago (express `requireRecentAuth`). Not a verdict on the session: the
 * interceptor passes it through untouched. `useStepUp().run` answers it with
 * "Confirm it’s you" (`@/hooks/use-step-up`) and retries the write once.
 */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED'

/** The maintenance modes express enforces, mildest first. */
const MAINTENANCE_MODES = ['off', 'read_only', 'full'] as const

/** One of `MAINTENANCE_MODES`. */
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number]

/** Whether `value` is one of `MAINTENANCE_MODES`. */
export function isMaintenanceMode(value: unknown): value is MaintenanceMode {
  return typeof value === 'string' && (MAINTENANCE_MODES as readonly string[]).includes(value)
}

/** `code` on the 503 while maintenance is `full`, on customer routes and on a non-staff sign-in. */
export const MAINTENANCE_MODE = 'MAINTENANCE_MODE'

/** `code` on the 503 for a write while maintenance is `read_only`. */
export const READ_ONLY_MODE = 'READ_ONLY_MODE'

/**
 * `GET /status/maintenance`, public. `message` is the owner's text for
 * customers, plain text; `since` is when the current mode began. Both are
 * `null` while the mode is `off`.
 */
export interface MaintenanceStatus {
  mode: MaintenanceMode
  message: string | null
  since: string | null
}

/**
 * `invitedBy` on a pending-invitation row, or `null` once the inviter's
 * account is gone (the column is `on delete set null`).
 */
interface InvitationInviter {
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
  /** When the invitation was last mailed, ISO; `null` if never. */
  lastSentAt: string | null
  /** When a resend is allowed again, ISO; `null` when it is allowed now. */
  resendAvailableAt: string | null
}

/** `POST /invitations/preview` with `{ token }`: what an invite link opens onto. */
export interface InvitationPreview {
  tenant: { name: string; slug: string }
  role: MembershipRole
  invitedBy: { firstName: string | null; lastName: string | null } | null
  /** The address the invitation was sent to. */
  email: string
}

/**
 * The `200` of `POST /invitations/verify` and `POST /invitations/confirm`: the
 * session, whether this click created the account, and the tenant joined.
 */
export interface InvitationSignIn {
  accessToken: string
  user: User
  isNewUser: boolean
  tenant: { name: string; slug: string }
  role: MembershipRole
}

/**
 * The `202` of `POST /invitations/verify`: no session, nothing spent. The
 * server mailed a confirmation link to `email`, the invited address.
 */
export interface InvitationConfirmationSent {
  confirmationSent: true
  email: string
}

/** What `POST /invitations/verify` answers: joined in one click, or "Check your inbox". */
export type InvitationVerifyResult = InvitationSignIn | InvitationConfirmationSent

/** `POST /invitations/accept`: the tenant the caller is now a member of. */
export interface AcceptedInvitation {
  tenant: { name: string; slug: string }
  /** The caller's current role there: an existing member keeps theirs, so not necessarily the invited one. */
  role: MembershipRole
  /** True when the caller had joined already, as on a repeat accept of the same link. */
  alreadyMember: boolean
}

/** `code` on the 409 for a create whose slug a live tenant already holds. */
export const SLUG_TAKEN = 'slug_taken'

/** `code` on the 409 for an invite to an address that already belongs to a member of this tenant. */
export const ALREADY_MEMBER = 'already_member'

/**
 * `code` on the 409 for an invite that lost a race with another invitation for
 * the same address. The revoke-and-reinsert runs in one transaction, so
 * retrying after a refresh is safe.
 */
export const INVITATION_CONFLICT = 'invitation_conflict'

/** `code` on the 404 for a resend or revoke of an invitation that is no longer pending. */
export const INVITATION_NOT_FOUND = 'invitation_not_found'

/** `code` on the 404 for a role change or removal whose target is not a member of the tenant. */
export const MEMBER_NOT_FOUND = 'member_not_found'

/** How an audit entry's actor reached the tenant. `system` is a script, with no actor. */
type AuditAccess = 'member' | 'platform' | 'system'

/** The actor on an audit entry. `name` is the email when the actor has no name on file. */
interface AuditActor {
  id: string
  name: string
  email: string
}

/** The kinds of record an audit entry points at that this app has a word for. */
export type KnownAuditTargetType =
  | 'tenant'
  | 'membership'
  | 'invitation'
  | 'settings'
  | 'user'
  | 'email_message'
  | 'email_suppression'
  | 'platform'

/** A target kind: a known one (autocompleted) or any other the API sends. */
export type AuditTargetType = KnownAuditTargetType | (string & {})

/** What an audit entry's action was done to. */
interface AuditTarget {
  /** A kind of record the API names; the platform tenant's log adds email and platform kinds, and a newer API may add more. */
  type: AuditTargetType
  id: string
}

/** One row of a tenant's `GET /tenants/:slug/audit-log`. */
export interface AuditEntry {
  id: string
  /** ISO 8601, millisecond precision. */
  occurredAt: string
  /** A stored action name: one of `AUDIT_ACTIONS`, or a retired or newer one the app has no wording for. */
  action: AuditAction | (string & {})
  access: AuditAccess
  actor: AuditActor | null
  target: AuditTarget | null
  /** Per-action; never a full email address or a token. */
  metadata: Record<string, unknown>
}

/** One sign-in method linked to the account, as `GET /auth/providers` lists it. */
interface AuthProviderLink {
  /** `'email'` or `'google'`. A string, so a new provider renders rather than breaks. */
  provider: string
  /** ISO timestamp of when the method was linked. */
  linkedAt: string
}

/**
 * `GET /auth/providers`. A Google sign-up also has an `'email'` row. Any other
 * field the API still sends is ignored.
 */
export interface AuthProviders {
  providers: AuthProviderLink[]
}

/** Where a tenant is in onboarding, as a member sees it; `stuck` reads `in_progress` and `awaiting_owner` reads `not_tracked`. */
type TenantOnboardingState = 'in_progress' | 'complete' | 'dismissed' | 'not_tracked'

/** Who completed a step: the server from an event, a member, or platform staff. */
type OnboardingSource = 'auto' | 'customer' | 'staff'

/**
 * One step of `GET /tenants/:slug/onboarding`, in the server registry's order.
 * A `member` step carries the caller's own completion, and `null` for a staff reader.
 */
export interface OnboardingStepView {
  key: string
  title: string
  description: string
  scope: 'tenant' | 'member'
  kind: 'auto' | 'manual'
  required: boolean
  completedAt: string | null
  source: OnboardingSource | null
}

/** `GET /tenants/:slug/onboarding`: the steps the server registry serves, and the tenant's progress through them. */
export interface TenantOnboarding {
  state: TenantOnboardingState
  steps: OnboardingStepView[]
  requiredDone: number
  requiredTotal: number
  /** When the last required step completed; `null` until then. */
  completedAt: string | null
  dismissedAt: string | null
}
