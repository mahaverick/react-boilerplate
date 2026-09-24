import { z } from 'zod'

/**
 * An invitation token as the server mints it: 32 random bytes, base64url,
 * no padding, so always 43 characters. Mirrors the token rule in
 * `invitation.validators.ts`, so a truncated link is caught before any request.
 */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
