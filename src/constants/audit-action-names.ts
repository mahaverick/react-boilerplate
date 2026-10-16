/**
 * @file The audit action names alone, apart from their wording, so a route's
 * `validateSearch` can name the Action facet's values without pulling the
 * sentences into the entry chunk.
 */
/**
 * The audit actions this app has wording for, which the Action facet offers.
 * An action the server stores that is not listed (a retired one such as
 * `tenant.errors_viewed`, which stays filterable on the API but is never
 * written again) still renders, through the fallback sentence.
 */
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
] as const
/** An audit action this app has wording for. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number]
