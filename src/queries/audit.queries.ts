import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { AuditAction } from '@/constants/audit-actions'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess, AuditEntry, AuditPage } from '@/types/api.types'

/** Narrows a tenant's audit log by action, actor or access path; a field left out filters nothing. */
export interface TenantAuditFilters {
  action?: AuditAction
  actorUserId?: string
  /** Only entries written under platform access, which the activity page labels "Staff". */
  access?: 'platform'
}

/**
 * The key of one tenant's audit log, filters included, under the tenant's
 * `['tenants', slug]` prefix: invalidating `tenantKeys.detail(slug)` without
 * `exact` refreshes the log too.
 */
const auditKeys = {
  tenant: (slug: string, filters: TenantAuditFilters) =>
    ['tenants', slug, 'audit-log', filters] as const,
}

/** The API's default page; its cap is 100. */
const PAGE_SIZE = 50

/** A tenant's activity log, newest first, a page at a time. Effective owners and admins only; anyone else gets a 403. */
export function useTenantAuditLog(
  slug: string,
  filters: TenantAuditFilters,
  { enabled }: { enabled: boolean }
) {
  return useInfiniteQuery({
    queryKey: auditKeys.tenant(slug, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<AuditPage<AuditEntry>>>(`/tenants/${slug}/audit-log`, {
          params: { ...filters, cursor: pageParam, limit: PAGE_SIZE },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    /** Switching a filter away and back shows what changed meanwhile, not a cached page. */
    staleTime: 0,
    /**
     * A 403 is not retried: the route's role check passed on cached data, so a
     * fresh 403 means the effective role changed server-side since.
     */
    retry: (failureCount, error) => statusFrom(error) !== 403 && failureCount < 1,
  })
}

/** The entries of every loaded page, in order. */
export function flattenAuditPages<T extends AuditEntry>(
  data: InfiniteData<AuditPage<T>> | undefined
): T[] {
  return data?.pages.flatMap((page) => page.entries) ?? []
}
