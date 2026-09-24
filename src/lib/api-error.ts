import { AxiosError } from 'axios'
import type { ApiErrorBody } from '@/types/api.types'

export function messageFrom(error: unknown): string {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.message) return body.message
  }
  return 'Something went wrong. Please try again.'
}

/**
 * The HTTP status a failed request answered with, or `undefined` when the
 * request never reached a response at all (a network failure, a timeout, or
 * a rejection that is not an axios error).
 *
 * The distinction matters: "the server said 404" and "there was no server"
 * are different outcomes, and a caller that treats the second as the first
 * renders "not found" for a dropped connection.
 */
export function statusFrom(error: unknown): number | undefined {
  return error instanceof AxiosError ? error.response?.status : undefined
}

/**
 * The envelope's machine-readable `code`, or `undefined` when the failure
 * carried none (or never reached a response at all).
 */
export function codeFrom(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (typeof body?.code === 'string') return body.code
  }
  return undefined
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
