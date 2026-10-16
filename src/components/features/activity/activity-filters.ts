import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS } from '@/constants/audit-actions'
import type { AuditTargetType, KnownAuditTargetType } from '@/types/api.types'

/** What an entry acted on, in a word. */
export const AUDIT_TARGET_LABELS: Record<KnownAuditTargetType, string> = {
  tenant: 'Tenant',
  membership: 'Membership',
  invitation: 'Invitation',
  settings: 'Settings',
  user: 'User',
  email_message: 'Email',
  email_suppression: 'Email suppression',
  platform: 'Platform',
}

/**
 * What an entry acted on, in words: the known label, else the API's name as
 * words ("billing_plan" reads "Billing plan"), so a kind this app has no label
 * for never renders blank.
 * @param type - The target's kind.
 */
export function auditTargetLabel(type: AuditTargetType): string {
  if (type in AUDIT_TARGET_LABELS) return AUDIT_TARGET_LABELS[type as KnownAuditTargetType]
  const words = type.replaceAll(/[._]+/g, ' ').trim()
  return words === '' ? '—' : words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The Action facet: every action this app has wording for. The retired
 * actions the API still stores and accepts as a filter are not offered, since
 * nothing writes them any more.
 */
export const ACTION_FILTER: DataTableFilter = {
  name: 'action',
  label: 'Action',
  options: AUDIT_ACTIONS.map((action) => ({ value: action, label: AUDIT_ACTION_LABELS[action] })),
}

/** The Access facet: how the actor reached the tenant. */
export const ACCESS_FILTER: DataTableFilter = {
  name: 'access',
  label: 'Access',
  options: [
    { value: 'platform', label: 'Staff' },
    { value: 'member', label: 'Member' },
    { value: 'system', label: 'System' },
  ],
}
