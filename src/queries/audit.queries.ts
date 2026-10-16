import { AUDIT_ACTIONS } from '@/constants/audit-action-names'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { defineList, idFilter, listFilter } from '@/schemas/list.schemas'
import type { AuditEntry } from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** A tenant's log's URL contract: newest first by default, filtered by action, actor and access path. */
export const tenantActivityList = defineList({
  sorts: ['-occurred', 'occurred'],
  filters: {
    action: listFilter(AUDIT_ACTIONS),
    actor: idFilter(),
    access: listFilter(['member', 'platform', 'system']),
  },
  table: analyticsKey('activity'),
})

/**
 * One page of a tenant's audit log, under the tenant's `['tenants', slug]`
 * prefix: invalidating `tenantKeys.detail(slug)` without `exact` refreshes
 * the log too. Effective owners and admins only. A 403 is not retried (the
 * default `retryList`): the role check passed on cached data, so it means the
 * role changed since. Never fresh, so returning to the page shows what
 * happened meanwhile.
 * @param slug - The tenant.
 * @param request - From `listRequest(tenantActivityList, …)`.
 */
export function tenantAuditListOptions(slug: string, request: ListRequest) {
  return listQueryOptions<AuditEntry>({
    key: ['tenants', slug, 'audit-log'],
    path: `/tenants/${slug}/audit-log`,
    request,
    staleTime: 0,
  })
}
