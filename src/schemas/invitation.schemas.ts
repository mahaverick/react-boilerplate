import { z } from 'zod'

/**
 * An invitation token as the server mints it: unpadded base64url, always 43
 * characters. Mirrors `invitation.validators.ts`, so a truncated link is
 * caught before any request.
 */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
