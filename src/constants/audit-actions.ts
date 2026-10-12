import { MEMBERSHIP_ROLES, ROLE_LABELS, type MembershipRole } from '@/constants/roles'

/** The audit actions this app has wording for. An action the server writes that is not listed still renders, through the fallback sentence. */
export const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.settings_updated',
  'member.role_changed',
  'member.removed',
  'member.left',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'platform.member.auto_joined',
  'platform.member.granted',
  'tenant.accessed_by_platform',
  'onboarding.dismissed',
  'onboarding.undismissed',
  'onboarding.step_completed',
  'onboarding.reminder_sent',
  'user.errors_viewed',
  'tenant.errors_viewed',
] as const
/** An audit action this app has wording for. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Whether a string from the API is an action this app has wording for. */
export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}

/** Short names, for the action filter. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'tenant.created': 'Tenant created',
  'tenant.updated': 'Tenant updated',
  'tenant.settings_updated': 'Settings changed',
  'member.role_changed': 'Role changed',
  'member.removed': 'Member removed',
  'member.left': 'Member left',
  'invitation.created': 'Invitation sent',
  'invitation.resent': 'Invitation resent',
  'invitation.revoked': 'Invitation revoked',
  'invitation.accepted': 'Invitation accepted',
  'platform.member.auto_joined': 'Staff auto-joined',
  'platform.member.granted': 'Staff role granted',
  'tenant.accessed_by_platform': 'Staff visit',
  'onboarding.dismissed': 'Getting started hidden',
  'onboarding.undismissed': 'Getting started shown',
  'onboarding.step_completed': 'Onboarding step completed',
  'onboarding.reminder_sent': 'Onboarding reminder sent',
  'user.errors_viewed': 'User errors viewed',
  'tenant.errors_viewed': 'Tenant errors viewed',
}

/** An audit row's per-action metadata, whose shape the server owns, so it is read defensively. */
type Metadata = Record<string, unknown>

/** A string value under `key`, or undefined when it is missing or not a string. */
function text(metadata: Metadata, key: string): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}

/** Whether a metadata string is one of the known membership roles. */
function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value)
}

/** The reader-facing label of the role under `key`; an unrecognised role shows as sent. */
function roleLabel(metadata: Metadata, key: string): string {
  const value = text(metadata, key)
  if (value === undefined) return 'an unknown role'
  return isMembershipRole(value) ? ROLE_LABELS[value] : value
}

/** " (name, website)", or nothing when the list is missing or empty. */
function changedFields(metadata: Metadata): string {
  const value = metadata.changed
  const fields = Array.isArray(value)
    ? value.filter((field): field is string => typeof field === 'string')
    : []
  return fields.length > 0 ? ` (${fields.join(', ')})` : ''
}

/** The invitee's domain only: the log never holds a full address. */
function domain(metadata: Metadata): string {
  return text(metadata, 'emailDomain') ?? 'an unknown domain'
}

/**
 * The step's key as words ("configure settings"): the registry lives on the
 * server, and this app does not mirror its titles.
 */
function stepName(metadata: Metadata): string {
  const key = text(metadata, 'stepKey')
  return key === undefined ? 'an onboarding step' : `the “${key.replaceAll('_', ' ')}” step`
}

/** "2 owners", "1 owner", or "the owners" when the count is missing. */
function recipients(metadata: Metadata): string {
  const count = metadata.recipientCount
  if (typeof count !== 'number') return 'the owners'
  return count === 1 ? '1 owner' : `${String(count)} owners`
}

/** The sentence for each action, built from the row's metadata. */
const SENTENCES: Record<AuditAction, (metadata: Metadata) => string> = {
  'tenant.created': (m) => `created the tenant “${text(m, 'name') ?? 'unnamed'}”`,
  'tenant.updated': (m) => `updated the tenant${changedFields(m)}`,
  'tenant.settings_updated': (m) => `changed the settings${changedFields(m)}`,
  'member.role_changed': (m) =>
    `changed a member’s role from ${roleLabel(m, 'from')} to ${roleLabel(m, 'to')}`,
  'member.removed': (m) =>
    m.self === true ? 'left the tenant' : `removed a member (${roleLabel(m, 'role')})`,
  'member.left': () => 'left the tenant',
  'invitation.created': (m) => `invited someone at ${domain(m)} as ${roleLabel(m, 'role')}`,
  'invitation.resent': (m) => `resent the invitation to someone at ${domain(m)}`,
  'invitation.revoked': (m) => `revoked the invitation to someone at ${domain(m)}`,
  'invitation.accepted': (m) => `accepted an invitation as ${roleLabel(m, 'role')}`,
  'platform.member.auto_joined': (m) =>
    `added someone at ${domain(m)} to the platform as Viewer (auto-join)`,
  'platform.member.granted': (m) => `granted a platform member the ${roleLabel(m, 'role')} role`,
  'tenant.accessed_by_platform': (m) =>
    `opened this tenant as platform staff (${roleLabel(m, 'platformRole')})`,
  'onboarding.dismissed': () => 'hid the getting started checklist',
  'onboarding.undismissed': () => 'showed the getting started checklist again',
  'onboarding.step_completed': (m) => `marked ${stepName(m)} complete`,
  'onboarding.reminder_sent': (m) => `sent an onboarding reminder to ${recipients(m)}`,
  'user.errors_viewed': () => 'viewed a user’s errors',
  'tenant.errors_viewed': () => 'viewed a tenant’s errors',
}

/**
 * What the actor did, as the rest of a sentence their name begins. Reads the
 * metadata defensively: a row written under an older schema still renders.
 */
export function auditSentence(entry: { action: string; metadata: Metadata }): string {
  const build: ((metadata: Metadata) => string) | undefined = isAuditAction(entry.action)
    ? SENTENCES[entry.action]
    : undefined
  return build ? build(entry.metadata) : `performed ${entry.action}`
}

/**
 * Who acted: their name, else their email, else the system (scripts have no
 * actor). Typed structurally, as `AuditActor` is not exported from
 * `api.types`, which itself imports this module's `AuditAction`. An `id`
 * field, present on the real actor, is accepted but not required.
 */
export function actorName(actor: { id?: string; name: string; email: string } | null): string {
  if (actor === null) return 'System'
  return actor.name === '' ? actor.email : actor.name
}
