/**
 * @file The tenant reads and writes that only a form loads: creating a tenant,
 * renaming it, and its settings. `tenant.queries` is in the first-visit chunk
 * through `_app`'s guard, so these stay apart and load with their pages.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import {
  invalidateTenantList,
  tenantKeys,
  type Tenant,
  type TenantSettings,
} from '@/queries/tenant.queries'
import type {
  NewTenantInput,
  UpdateTenantInput,
  UpdateTenantSettingsInput,
} from '@/schemas/tenant.schemas'
import type { ApiSuccess } from '@/types/api.types'

/** Creates a tenant with the caller as its owner, then refetches the tenant list. */
export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewTenantInput) =>
      unwrap(await apiClient.post<ApiSuccess<Tenant>>('/tenants', input)),
    onSuccess: () => invalidateTenantList(queryClient),
  })
}

/** Updates the tenant, refreshing its detail and the list, which carries the name for the switcher. */
export function useUpdateTenant(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantInput) =>
      unwrap(await apiClient.patch<ApiSuccess<Tenant>>(`/tenants/${slug}`, input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug) })
      await invalidateTenantList(queryClient)
    },
  })
}

/** A tenant's settings. Anyone who can open the tenant may read them; saving is limited to owners and admins. */
export function useTenantSettings(slug: string) {
  return useQuery({
    queryKey: tenantKeys.settings(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantSettings>>(`/tenants/${slug}/settings`)),
  })
}

/** Saves the fields of a tenant's settings it is given, then refetches the settings. */
export function useUpdateTenantSettings(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantSettingsInput) =>
      unwrap(await apiClient.patch<ApiSuccess<TenantSettings>>(`/tenants/${slug}/settings`, input)),
    /** A saved change completes the configure-settings onboarding step, so its card refetches too. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.settings(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.onboarding(slug) })
    },
  })
}
