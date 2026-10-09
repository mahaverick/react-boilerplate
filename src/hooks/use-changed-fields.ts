/**
 * @file The values an edit form diffs against, frozen when the form mounts so
 * that "changed" means changed by this user in this form, not by a background
 * refetch that brought someone else's edit.
 */
import { useState } from 'react'
import type { z } from 'zod'
import { changedFieldsOf } from '@/schemas/changed-fields.schemas'

/**
 * Holds an edit form's baseline and the schema that checks and sends only what
 * differs from it. Pass `baseline` as the form's `defaultValues`, so the form
 * and the diff never disagree about what was loaded; after a successful save,
 * `rebase` with the values just saved. A refetch never moves the baseline.
 * @param schema - The form's full object schema.
 * @param loaded - The stored values when the form mounts.
 * @returns The frozen baseline, the changed-fields schema over it, and `rebase`.
 */
export function useChangedFields<Shape extends z.core.$ZodShape>(
  schema: z.ZodObject<Shape>,
  loaded: z.input<z.ZodObject<Shape>>
) {
  const [baseline, rebase] = useState(loaded)
  return { baseline, changes: changedFieldsOf(schema, baseline), rebase }
}
