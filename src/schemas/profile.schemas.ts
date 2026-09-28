import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_NAME_LENGTH = 100

/** The API validates both names with one shared field, so its message names neither. */
const SHARED_NAME_MESSAGE = notAllowedMessage('This field')

/**
 * The two fields the API's updateProfileSchema accepts; it strips any other
 * key, so email and every other user column cannot change here. Both are
 * required on this form, where the API also takes them as optional or `null`.
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
