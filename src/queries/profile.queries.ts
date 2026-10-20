import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { UpdateProfileInput } from '@/schemas/profile.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

/** The key of the caller's profile, which `refreshProfile` and the update mutations write the returned user into. */
export const profileKeys = { detail: ['profile'] as const }

/**
 * Refetches `/profile` into the query cache and the store, so a change to the
 * caller's own platform membership (accepting an invitation, a self role
 * change or self-removal in the platform tenant) shows without a reload.
 *
 * A failed refresh is swallowed, leaving the store stale until the next fetch.
 */
export async function refreshProfile(queryClient: QueryClient): Promise<void> {
  try {
    const user = unwrap(await apiClient.get<ApiSuccess<User>>('/profile'))
    queryClient.setQueryData(profileKeys.detail, user)
    const { accessToken, login } = useAuthStore.getState()
    if (accessToken) login(accessToken, user)
  } catch {
    // Swallowed: this runs from a mutation's `onSuccess`, where a rejection would fail the mutation that just succeeded.
  }
}

/** The caller's profile, painted from the stored user while it refetches. */
export function useProfile() {
  return useQuery({
    queryKey: profileKeys.detail,
    queryFn: async ({ signal }) =>
      unwrap(await apiClient.get<ApiSuccess<User>>('/profile', { signal })),
    /** Paints from the user already in the auth store, not empty inputs. */
    initialData: () => useAuthStore.getState().user ?? undefined,
  })
}

/**
 * Turns browser analytics off or on for the caller (`PATCH /profile
 * { analyticsOptOut }`). The returned user lands in the store, whose analytics
 * subscription (`installAnalyticsIdentity`) applies the new preference.
 */
export function useUpdateAnalyticsOptOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (analyticsOptOut: boolean) =>
      unwrap(await apiClient.patch<ApiSuccess<User>>('/profile', { analyticsOptOut })),
    onSuccess: (user) => {
      queryClient.setQueryData(profileKeys.detail, user)
      const { accessToken, login } = useAuthStore.getState()
      if (accessToken) login(accessToken, user)
    },
  })
}

/** Updates the caller's profile fields (`PATCH /profile`) and stores the returned user. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<UpdateProfileInput>) =>
      unwrap(await apiClient.patch<ApiSuccess<User>>('/profile', input)),
    onSuccess: (user) => {
      queryClient.setQueryData(profileKeys.detail, user)
      const { accessToken, login } = useAuthStore.getState()
      if (accessToken) login(accessToken, user)
    },
  })
}
