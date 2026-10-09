/**
 * @file Narrows an edit form's object schema to the fields the user changed,
 * so a save checks and sends only those: a stored value that today's rules
 * refuse neither blocks saving another field nor goes back to the API.
 */
import { z } from 'zod'

/**
 * A schema over the whole form whose output is a PATCH body of the changed
 * fields only. A field is changed when its value is not the one in `baseline`
 * (the stored values the form opened with); each changed field is checked
 * with its own schema in `schema`, and its issues keep the field's path, so
 * the message lands under that field. An unchanged field is neither checked
 * nor sent. Object-level refinements on `schema` are not run.
 * @param schema - The form's full object schema.
 * @param baseline - The form's values as loaded, before any edit.
 * @returns A schema to validate the form with and to parse the body from.
 */
export function changedFieldsOf<Shape extends z.core.$ZodShape>(
  schema: z.ZodObject<Shape>,
  baseline: z.input<z.ZodObject<Shape>>
) {
  return z.custom<z.input<z.ZodObject<Shape>>>().transform((value, ctx) => {
    const values = value as Record<string, unknown>
    const loaded = baseline as Record<string, unknown>
    const changed: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(schema.shape)) {
      if (Object.is(values[key], loaded[key])) continue
      const result = z.safeParse(field, values[key])
      if (result.success) {
        changed[key] = result.data
        continue
      }
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: [key, ...issue.path] })
      }
    }
    return changed as Partial<z.output<z.ZodObject<Shape>>>
  })
}
