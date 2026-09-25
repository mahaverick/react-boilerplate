import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { UpdateProfileInput } from '@/schemas/profile.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

export const profileKeys = { detail: ['profile'] as const }

/**
 * Refetches `/profile` and updates both the query cache and the store, so a
 * change that alters the caller's OWN platform membership — accepting an
 * invitation, or a self role change or self-removal in the platform tenant —
 * is reflected wherever the store is read from, not only after a reload.
 *
 * Swallows a failed refresh rather than throwing: called from a mutation's
 * `onSuccess`, where a rejection would fail the mutation that just
 * succeeded. A failed refresh leaves the store stale until the next fetch or
 * reload, which is the behaviour this exists to improve on, not regress.
 */
export async function refreshProfile(queryClient: QueryClient): Promise<void> {
  try {
    const user = unwrap(await apiClient.get<ApiSuccess<User>>('/profile'))
    queryClient.setQueryData(profileKeys.detail, user)
    const { accessToken, login } = useAuthStore.getState()
    if (accessToken) login(accessToken, user)
  } catch {
    // See the doc comment: deliberately swallowed.
  }
}

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.detail,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<User>>('/profile')),
    // The store already holds the user the session bootstrap fetched, so the
    // page paints from it instead of flashing empty inputs on every visit.
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
      // Keep the store's copy in step, since the layout reads from it.
      const { accessToken, login } = useAuthStore.getState()
      if (accessToken) login(accessToken, user)
    },
  })
}
