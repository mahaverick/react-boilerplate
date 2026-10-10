import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { AuditAction } from '@/constants/audit-actions'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess, AuditEntry, AuditPage } from '@/types/api.types'

export interface TenantAuditFilters {
  action?: AuditAction
  actorUserId?: string
  /** "Staff": everything done under platform access. */
  access?: 'platform'
}

/**
 * The tenant log sits under `['tenants', slug]`, so a tenant update that
 * invalidates the detail without `exact` refreshes its log too.
 */
const auditKeys = {
  tenant: (slug: string, filters: TenantAuditFilters) =>
    ['tenants', slug, 'audit-log', filters] as const,
}

/** The API's default page; its cap is 100. */
const PAGE_SIZE = 50

/** A tenant's activity. Effective owners and admins only; anyone else gets a 403. */
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

/** Every loaded page, flattened. */
export function flattenAuditPages<T extends AuditEntry>(
  data: InfiniteData<AuditPage<T>> | undefined
): T[] {
  return data?.pages.flatMap((page) => page.entries) ?? []
}
