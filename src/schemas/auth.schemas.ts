import { z } from 'zod'

const MIN_PASSWORD_LENGTH = 8
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 100

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters.`)

/** Registration/reset policy. NOT used for login or verify-email. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)

const nameSchema = z.string().trim().min(1, 'This field is required.').max(MAX_NAME_LENGTH)

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately policy-free: this is a comparison against a stored hash,
  // exactly like the backend's loginSchema.
  password: z.string().min(1, 'Password is required.'),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
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
  // The backend requires the account password here and does not treat it
  // as optional. No policy applied, for the same reason as login.
  password: z.string().min(1, 'Password is required.'),
})

export const resendVerificationSchema = z.object({ email: emailSchema })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
