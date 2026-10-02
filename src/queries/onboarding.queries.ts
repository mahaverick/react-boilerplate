import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { tenantKeys } from '@/queries/tenant.queries'
import type { ApiSuccess, TenantOnboarding } from '@/types/api.types'

/** `GET /tenants/:slug/onboarding`: any member, and staff through platform access. */
export function tenantOnboardingQueryOptions(slug: string) {
  return queryOptions({
    queryKey: tenantKeys.onboarding(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantOnboarding>>(`/tenants/${slug}/onboarding`)),
  })
}

export function useTenantOnboarding(slug: string) {
  return useQuery(tenantOnboardingQueryOptions(slug))
}

/**
 * The three onboarding writes share one cache rule: refetch the checklist on
 * settle, not success, because a 409 (`not_manual`, `not_tracked`,
 * `dismiss_state`) means the card showed a state the server no longer holds.
 * The response body is not read; the refetch is the source of truth.
 */
function useOnboardingWrite<TVariables>(slug: string, path: (variables: TVariables) => string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      await apiClient.post<ApiSuccess<unknown>>(`/tenants/${slug}/onboarding${path(variables)}`)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.onboarding(slug) }),
  })
}

/** Marks a manual step done; a member-scoped one completes for the caller alone. */
export function useCompleteOnboardingStep(slug: string) {
  return useOnboardingWrite<string>(slug, (stepKey) => `/steps/${stepKey}/complete`)
}

/** Hides the checklist for the whole tenant. Owner only, and never through platform access. */
export function useDismissOnboarding(slug: string) {
  return useOnboardingWrite<void>(slug, () => '/dismiss')
}

/** Shows a dismissed checklist again. Owner only, as dismiss. */
export function useUndismissOnboarding(slug: string) {
  return useOnboardingWrite<void>(slug, () => '/undismiss')
}
