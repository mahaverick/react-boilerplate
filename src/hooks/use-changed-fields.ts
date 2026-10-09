/**
 * @file The values an edit form diffs against, frozen when the form mounts so
 * that "changed" means changed by this user in this form, not by a background
 * refetch that brought someone else's edit.
 */
import { useState } from 'react'
import type { z } from 'zod'
import type { ServerErrors } from '@/hooks/use-server-errors'
import { changedFieldsOf } from '@/schemas/changed-fields.schemas'

/**
 * Holds an edit form's baseline and the schema that checks and sends only what
 * differs from it. Pass `baseline` as the form's `defaultValues`, `changes` as
 * its `onSubmit` validator and `listeners` as its listeners; in `onSubmit`,
 * post `changedBody(value)` unless it is `null`, and `rebase` with the values
 * just saved once the save succeeds. A refetch never moves the baseline.
 * @param schema - The form's full object schema.
 * @param loaded - The stored values when the form mounts.
 * @param serverErrors - The form's errors, where an unchanged save is told to change something.
 * @param unchangedMessage - What an unchanged save says, such as "Change a field before saving."
 * @returns The baseline, the changed-fields schema over it, `changedBody`, `listeners` and `rebase`.
 */
export function useChangedFields<Shape extends z.core.$ZodShape>(
  schema: z.ZodObject<Shape>,
  loaded: z.input<z.ZodObject<Shape>>,
  serverErrors: ServerErrors,
  unchangedMessage: string
) {
  const [baseline, rebase] = useState(loaded)
  const changes = changedFieldsOf(schema, baseline)

  /**
   * The PATCH body of the changed fields, or `null` after putting
   * `unchangedMessage` in the form-level errors when nothing changed.
   */
  function changedBody(value: z.input<z.ZodObject<Shape>>) {
    const body = changes.parse(value)
    if (Object.keys(body).length > 0) return body
    serverErrors.reset()
    serverErrors.setFormErrors([unchangedMessage])
    return null
  }

  /** Drops the unchanged-save message as soon as a field changes; other form errors stand. */
  function clearUnchangedMessage() {
    const { formErrors } = serverErrors
    if (formErrors.length === 1 && formErrors[0] === unchangedMessage)
      serverErrors.setFormErrors([])
  }

  return { baseline, changes, changedBody, listeners: { onChange: clearUnchangedMessage }, rebase }
}
