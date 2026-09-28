import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { UpdateProfileInput } from '@/schemas/profile.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

export const profileKeys = { detail: ['profile'] as const }

/**
 * Refetches `/profile` into the query cache and the store, so a change to the
 * caller's own platform membership (accepting an invitation, a self role
 * change or self-removal in the platform tenant) shows without a reload.
 *
 * A failed refresh is swallowed, leaving the store stale until the next fetch:
 * it runs from a mutation's `onSuccess`, where a rejection would fail the
 * mutation that just succeeded.
 */
export async function refreshProfile(queryClient: QueryClient): Promise<void> {
  try {
    const user = unwrap(await apiClient.get<ApiSuccess<User>>('/profile'))
    queryClient.setQueryData(profileKeys.detail, user)
    const { accessToken, login } = useAuthStore.getState()
    if (accessToken) login(accessToken, user)
  } catch {
    // Swallowed: a rejection would fail the mutation that just succeeded.
  }
}

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.detail,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<User>>('/profile')),
    /** Paints from the user the session bootstrap stored, not empty inputs. */
    initialData: () => useAuthStore.getState().user ?? undefined,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) =>
      unwrap(await apiClient.patch<ApiSuccess<User>>('/profile', input)),
    onSuccess: (user) => {
      queryClient.setQueryData(profileKeys.detail, user)
      const { accessToken, login } = useAuthStore.getState()
      if (accessToken) login(accessToken, user)
    },
  })
}
