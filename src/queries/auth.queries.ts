import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { broadcastLogout } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
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

const LOGOUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again."

/**
 * Signs out server-side first; the local session ends only once the server's has.
 * `returnTo` is the same-origin path to land on afterwards, `/login` by default.
 */
export function useLogout({ returnTo = ROUTES.login }: { returnTo?: string } = {}) {
  const logout = useAuthStore((s) => s.logout)
  const endSession = () => {
    logout()
    broadcastLogout()
    window.location.assign(returnTo)
  }
  return useMutation({
    // skipAuthRetry: a 401 here is handled below, not by the interceptor's verdict path.
    mutationFn: async () =>
      apiClient.post<ApiSuccess<unknown>>('/auth/logout', undefined, { skipAuthRetry: true }),
    onSuccess: endSession,
    onError: (error) => {
      // 401: the server already considers the session over. Anything else (no
      // response, 5xx, 429) left it alive server-side, so it stays alive here.
      if (statusFrom(error) === 401) {
        endSession()
        return
      }
      toast.error(LOGOUT_FAILED_MESSAGE)
    },
  })
}
