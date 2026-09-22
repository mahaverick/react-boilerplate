import { z } from 'zod'

const MAX_NAME_LENGTH = 100

/**
 * Mirrors the backend's updateProfileSchema exactly: two fields, and it
 * rejects everything else. email, password and every other user column are
 * deliberately absent — PATCH /profile will reject them.
 */
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(MAX_NAME_LENGTH),
  lastName: z.string().trim().min(1, 'Last name is required.').max(MAX_NAME_LENGTH),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
