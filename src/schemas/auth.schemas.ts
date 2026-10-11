import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MIN_PASSWORD_LENGTH = 8
/**
 * bcrypt uses only the first 72 bytes of a password and ignores the rest, so
 * two passwords sharing that prefix would hash identically; the API refuses a
 * longer password instead. Counted in bytes, not characters: one emoji is four.
 */
const MAX_PASSWORD_BYTES = 72
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 100

const encoder = new TextEncoder()

/** The email field's rule. The address is trimmed and lowercased before it is checked and sent. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters.`)

/** The policy for a password being set: registration, reset and change-password. Login and verify-email apply none. */
const newPasswordSchema = z
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

/** The sign-in form's values. */
export const loginSchema = z.object({
  email: emailSchema,
  /** No policy: this is compared against a stored hash, as on the API. */
  password: z.string().min(1, 'Password is required.'),
})

/** The registration form's values; both names are optional. */
export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  firstName: nameSchema('First name'),
  lastName: nameSchema('Last name'),
})

/** The forgot-password form's values. */
export const forgotPasswordSchema = z.object({ email: emailSchema })

/** The reset form's values: the mailed token and the new password, entered twice. */
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

/** The verify-email form's values: the mailed token and the account's password. */
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
  /** Required by the API; no policy, since it is compared against a stored hash. */
  password: z.string().min(1, 'Password is required.'),
})

/** The resend-verification form's values. */
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

/** What the sign-in form submits, after parsing. */
export type LoginInput = z.infer<typeof loginSchema>
/** What the registration form submits, after parsing. */
export type RegisterInput = z.infer<typeof registerSchema>
/** What the forgot-password form submits, after parsing. */
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
/** What the reset form submits, after parsing. */
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
/** What the verify-email form submits, after parsing. */
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
/** What the resend-verification form submits, after parsing. */
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
/** What the change-password form submits, after parsing. */
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
