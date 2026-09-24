import { useMutation } from '@tanstack/react-query'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@/schemas/auth.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, User } from '@/types/api.types'

interface AuthPayload {
  accessToken: string
  user: User
}

export function useLogin() {
  const login = useAuthStore((s) => s.login)
  return useMutation({
    mutationFn: async (input: LoginInput) =>
      unwrap(await apiClient.post<ApiSuccess<AuthPayload>>('/auth/login', input)),
    onSuccess: (data) => login(data.accessToken, data.user),
  })
}

/** Registers an address; the API answers 202 with `data: null` whether or not it was free. */
export function useRegister() {
  return useMutation({
    mutationFn: async (input: RegisterInput) =>
      unwrap(await apiClient.post<ApiSuccess<null>>('/auth/register', input)),
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/forgot-password', input),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) =>
      // confirmPassword is a client-side concern; the API does not accept it.
      apiClient.post<ApiSuccess<unknown>>('/auth/reset-password', {
        token: input.token,
        password: input.password,
      }),
  })
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (input: VerifyEmailInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/verify-email', input),
  })
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (input: ResendVerificationInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/resend-verification', input),
  })
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  return useMutation({
    mutationFn: async () => apiClient.post<ApiSuccess<unknown>>('/auth/logout'),
    // Clear locally whatever the network did. A user who clicked logout
    // must end up logged out.
    onSettled: () => {
      logout()
      window.location.assign(ROUTES.login)
    },
  })
}
