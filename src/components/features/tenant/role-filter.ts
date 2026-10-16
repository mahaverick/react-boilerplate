import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { MEMBERSHIP_ROLES, ROLE_LABELS } from '@/constants/roles'

/** The Role facet of every list that has one, every role in descending authority. */
export const ROLE_FILTER: DataTableFilter = {
  name: 'role',
  label: 'Role',
  options: MEMBERSHIP_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
}
