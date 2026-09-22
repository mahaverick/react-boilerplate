import { AxiosError } from 'axios'
import type { ApiErrorBody } from '@/types/api.types'

export function messageFrom(error: unknown): string {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.message) return body.message
  }
  return 'Something went wrong. Please try again.'
}

/** The one key in `errors` that is NOT a field name. See below. */
const FORM_ERRORS_KEY = 'formErrors'

/**
 * Field-level validator detail, for mapping onto form inputs.
 *
 * The backend builds this from `z.flattenError` as `{...fieldErrors,
 * ...(formErrors.length > 0 && {formErrors})}`, so every key is a field
 * name EXCEPT the reserved `formErrors` — schema-level issues that name no
 * single field. Those are split out by `formErrorsFrom` below; attaching
 * them to an input called "formErrors" would render an error against a
 * field that does not exist.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(allErrorsFrom(error)).filter(([key]) => key !== FORM_ERRORS_KEY)
  )
}

/** Schema-level issues that name no field. Render these at form level. */
export function formErrorsFrom(error: unknown): string[] {
  return allErrorsFrom(error)[FORM_ERRORS_KEY] ?? []
}

function allErrorsFrom(error: unknown): Record<string, string[]> {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.errors && typeof body.errors === 'object') return body.errors
  }
  return {}
}
