import '@/lib/zod-jitless'
import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_NAME_LENGTH = 100

/** The API validates both names with one shared field, so its message names neither. */
const SHARED_NAME_MESSAGE = notAllowedMessage('This field')

/**
 * The profile form's two name fields, which the API's updateProfileSchema
 * accepts beside `analyticsOptOut`; it strips any other key, so email and
 * every other user column cannot change here. A name the form sends may not be
 * blank, where the API also takes `null`.
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

/** What the profile form submits, after parsing. */
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
