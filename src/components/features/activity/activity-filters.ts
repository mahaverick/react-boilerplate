import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS } from '@/constants/audit-actions'
import type { AuditEntry } from '@/types/api.types'

/** What an entry acted on, in a word. */
export const AUDIT_TARGET_LABELS: Record<NonNullable<AuditEntry['target']>['type'], string> = {
  tenant: 'Tenant',
  membership: 'Membership',
  invitation: 'Invitation',
  settings: 'Settings',
  user: 'User',
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
