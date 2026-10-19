import { AxiosError } from 'axios'
import { READ_ONLY_MODE, type ApiErrorBody } from '@/types/api.types'

/**
 * What a write refused by read-only maintenance says. The 503's own `message`
 * is the owner's notice for the whole maintenance period, not a reason this
 * one write failed.
 */
export const READ_ONLY_MODE_MESSAGE = 'Changes are paused during maintenance.'

/**
 * The envelope's `message`, `READ_ONLY_MODE_MESSAGE` for a `READ_ONLY_MODE`
 * refusal, a connection prompt when no response arrived, or a generic retry
 * prompt when the failure carried no message.
 */
export function messageFrom(error: unknown): string {
  if (error instanceof AxiosError) {
    if (!error.response)
      return "We couldn't reach the server. Check your connection, then try again."
    const body = error.response.data as ApiErrorBody | undefined
    if (body?.code === READ_ONLY_MODE) return READ_ONLY_MODE_MESSAGE
    if (body?.message) return body.message
  }
  return 'Something went wrong. Try again.'
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

/** The one HTTP-date form servers send, such as `Sun, 06 Nov 1994 08:49:37 GMT`. */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/

/**
 * How long a refused request says to wait, in whole seconds and at least 1,
 * from the `Retry-After` response header (a non-negative whole number of seconds, or an IMF-fixdate HTTP date).
 * `null` when there is no response or header, or the header cannot be read.
 */
export function retryAfterSecondsFrom(error: unknown): number | null {
  if (!(error instanceof AxiosError)) return null
  const header: unknown = error.response?.headers?.['retry-after']
  if (typeof header !== 'string' && typeof header !== 'number') return null
  const value = String(header).trim()
  if (/^\d+$/.test(value)) return Math.max(1, Number(value))
  // Date.parse reads "1.5", "-5" or "abc 12" as a date; only the IMF-fixdate form is an HTTP-date.
  if (!IMF_FIXDATE.test(value)) return null
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(1, Math.ceil((date - Date.now()) / 1_000))
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

/** The envelope's `errors` map, or an empty one when the failure carried none. */
function allErrorsFrom(error: unknown): Record<string, string[]> {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.errors && typeof body.errors === 'object') return body.errors
  }
  return {}
}
