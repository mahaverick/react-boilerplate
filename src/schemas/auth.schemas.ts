import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MIN_PASSWORD_LENGTH = 8
/**
 * bcrypt hashes at most 72 bytes and ignores the rest, so the API refuses a
 * longer password. Counted in bytes, not characters: one emoji is four.
 */
const MAX_PASSWORD_BYTES = 72
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 100

const encoder = new TextEncoder()

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters.`)

/** Registration, reset and change-password policy. NOT used for login or verify-email. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)
  .refine(
    (value) => encoder.encode(value).length <= MAX_PASSWORD_BYTES,
    `Password must be at most ${MAX_PASSWORD_BYTES} bytes long.`
  )

/**
 * An optional name, as on the API: an empty control means "not given" and is
 * dropped from the payload rather than posting `''`, which the API rejects.
 */
function nameSchema(label: string) {
  return z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH, `Name must be at most ${MAX_NAME_LENGTH} characters.`)
    .refine(safeText(), notAllowedMessage(label))
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

export const loginSchema = z.object({
  email: emailSchema,
  /** No policy: this is compared against a stored hash, as on the API. */
  password: z.string().min(1, 'Password is required.'),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  firstName: nameSchema('First name'),
  lastName: nameSchema('Last name'),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Token is required.'),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
  /** Required by the API; no policy, since it is compared against a stored hash. */
  password: z.string().min(1, 'Password is required.'),
})

export const resendVerificationSchema = z.object({ email: emailSchema })

/**
 * Mirrors the backend's changePasswordSchema, plus a confirmation it never
 * sees. `currentPassword` carries no policy, for the same reason as login's.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
