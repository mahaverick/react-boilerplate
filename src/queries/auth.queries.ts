import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { broadcastLogout } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@/schemas/auth.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { ApiSuccess, AuthProviders, User } from '@/types/api.types'

/** What `POST /auth/login` answers: the access token and the signed-in user. */
interface AuthPayload {
  accessToken: string
  user: User
}

/** The key of the caller's linked sign-in methods (`useAuthProviders`), under an `auth` prefix of its own. */
export const authKeys = { providers: ['auth', 'providers'] as const }

/** Signs in with email and password and puts the access token and user in the auth store. */
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

/** Asks for a password-reset email. The API answers 202 whether or not the address has an account. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/forgot-password', input),
  })
}

/** Resets the password with the emailed token; `confirmPassword` stays client-side. */
export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/reset-password', {
        token: input.token,
        password: input.password,
      }),
  })
}

/** Confirms an address with the token from the verification email. */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (input: VerifyEmailInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/verify-email', input),
  })
}

/** Asks the API for a fresh verification link; it answers the same whether or not the address belongs to an unverified account, so success says nothing about the address. */
export function useResendVerification() {
  return useMutation({
    mutationFn: async (input: ResendVerificationInput) =>
      apiClient.post<ApiSuccess<unknown>>('/auth/resend-verification', input),
  })
}

/** The sign-in methods linked to the caller's account, and whether it has a password. */
export function useAuthProviders() {
  return useQuery({
    queryKey: authKeys.providers,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<AuthProviders>>('/auth/providers')),
  })
}

/**
 * Changes the caller's password; `confirmPassword` stays client-side. The API
 * keeps this session and revokes every other one.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) =>
      apiClient.post<ApiSuccess<null>>('/auth/change-password', {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      }),
  })
}

/** What `POST /auth/sessions/revoke-others` answers: how many other sessions it ended. */
export interface RevokedSessions {
  revoked: number
}

/**
 * Signs the caller out everywhere but here: the API revokes every other
 * session of this user and keeps the current one. It sends an empty JSON
 * object, the body the API documents for the route.
 */
export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.post<ApiSuccess<RevokedSessions>>('/auth/sessions/revoke-others', {})),
  })
}

const LOGOUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again."

/**
 * Signs out server-side first; the local session ends only once the server's
 * has, or the server answers 401 (its session is already over).
 * `returnTo` is the same-origin path to land on afterwards, `/login` by default.
 */
export function useLogout({ returnTo = ROUTES.login }: { returnTo?: string } = {}) {
  const logout = useAuthStore((s) => s.logout)
  /** Ends this tab's session, tells the other tabs, and loads `returnTo` as a full page. */
  const endSession = () => {
    logout()
    broadcastLogout()
    window.location.assign(returnTo)
  }
  return useMutation({
    // skipAuthRetry: onError below alone decides what a failed logout means.
    mutationFn: async () =>
      apiClient.post<ApiSuccess<unknown>>('/auth/logout', undefined, { skipAuthRetry: true }),
    onSuccess: endSession,
    onError: (error) => {
      // A 401 is taken as the session already over; no response, 5xx or 429 leave it alive.
      if (statusFrom(error) === 401) {
        endSession()
        return
      }
      toast.error(LOGOUT_FAILED_MESSAGE)
    },
  })
}
