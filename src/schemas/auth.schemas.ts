import '@/lib/zod-jitless'
import { z } from 'zod'

const MAX_EMAIL_LENGTH = 320

/** The email field's rule. The address is trimmed and lowercased before it is checked and sent. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters.`)

/** The sign-in-link form's values: the address the link is mailed to. */
export const signInLinkRequestSchema = z.object({ email: emailSchema })
