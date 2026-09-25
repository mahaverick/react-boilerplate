import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { AuditAction } from '@/constants/audit-actions'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type {
  ApiSuccess,
  AuditAccess,
  AuditEntry,
  AuditPage,
  PlatformAuditEntry,
} from '@/types/api.types'

export interface TenantAuditFilters {
  action?: AuditAction
  actorUserId?: string
  /** "Staff": everything done under platform access. */
  access?: 'platform'
}

export interface PlatformAuditFilters {
  tenantId?: string
  actorUserId?: string
  action?: AuditAction
  access?: AuditAccess
}

/**
 * The tenant log sits under `['tenants', slug]`, so a tenant update that
 * invalidates the detail without `exact` refreshes its log too.
 */
export const auditKeys = {
  tenant: (slug: string, filters: TenantAuditFilters) =>
    ['tenants', slug, 'audit-log', filters] as const,
  platform: (filters: PlatformAuditFilters) => ['platform', 'audit-log', filters] as const,
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
    // Below the client's 30s default: switching a filter away and back must
    // show what changed meanwhile, not a few-seconds-old cached page.
    staleTime: 0,
  })
}

/** Every tenant's activity. Platform owners and admins only; anyone else gets a 404. */
export function usePlatformAuditLog(filters: PlatformAuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.platform(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<AuditPage<PlatformAuditEntry>>>('/platform/audit-log', {
          params: { ...filters, cursor: pageParam, limit: PAGE_SIZE },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // A 404 is the API's answer about who is asking; asking again changes nothing.
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
    staleTime: 0,
  })
}

/** Every loaded page, flattened. */
export function flattenAuditPages<T extends AuditEntry>(
  data: InfiniteData<AuditPage<T>> | undefined
): T[] {
  return data?.pages.flatMap((page) => page.entries) ?? []
}
