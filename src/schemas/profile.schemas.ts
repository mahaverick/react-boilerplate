import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_NAME_LENGTH = 100

// The API validates both names with one shared field, so its message names neither.
const SHARED_NAME_MESSAGE = notAllowedMessage('This field')

/**
 * Mirrors the backend's updateProfileSchema exactly: two fields, and it
 * rejects everything else. email, password and every other user column are
 * deliberately absent — PATCH /profile will reject them.
 */
export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required.')
    .max(MAX_NAME_LENGTH)
    .refine(safeText(), SHARED_NAME_MESSAGE),
  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required.')
    .max(MAX_NAME_LENGTH)
    .refine(safeText(), SHARED_NAME_MESSAGE),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
