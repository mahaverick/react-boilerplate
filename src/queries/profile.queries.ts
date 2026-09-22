import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { UpdateProfileInput } from '@/schemas/profile.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

export const profileKeys = { detail: ['profile'] as const }

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
