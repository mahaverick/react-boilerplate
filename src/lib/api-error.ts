import { AxiosError } from 'axios'
import type { ApiErrorBody } from '@/types/api.types'

/** The envelope's `message`, or a generic retry prompt when the failure carried none. */
export function messageFrom(error: unknown): string {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.message) return body.message
  }
  return 'Something went wrong. Please try again.'
}

/**
 * The HTTP status a failed request answered with, or `undefined` when the
 * request never reached a response (a network failure, a timeout, or a
 * rejection that is not an axios error), so a dropped connection never reads
 * as a 404.
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

/** The one key in `errors` that is not a field name. */
const FORM_ERRORS_KEY = 'formErrors'

/**
 * Field-level validator detail, for mapping onto form inputs. The backend
 * spreads `z.flattenError`'s field errors into `errors` beside a reserved
 * `formErrors` key for schema-level issues, which is left out here and read
 * by `formErrorsFrom`.
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
