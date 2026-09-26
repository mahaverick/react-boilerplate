import * as React from 'react'
import { fieldErrorsFrom, formErrorsFrom, messageFrom } from '@/lib/api-error'

/**
 * The backend's validator detail, held for as long as it is still true.
 *
 * Spec section 9 requires inline errors under each field, mapped from the
 * envelope's `errors`. That map has one reserved key — `formErrors` — whose
 * messages name no field, so they are kept apart here and rendered by
 * `<FormError>` at form level. `@/lib/api-error` does the splitting.
 */
export interface ServerErrors {
  /** Per-field messages, keyed by field name. Never holds `formErrors`. */
  fieldErrors: Record<string, string[]>
  /**
   * Messages that name no single field: the schema-level ones, or the
   * response's own message when it carried no field detail at all.
   */
  formErrors: string[]
  /** Read a failed mutation's response into both collections. */
  capture: (error: unknown) => void
  /** Drop one field's messages. Called when that field changes. */
  clearField: (name: string) => void
  /**
   * Put messages on one field by hand, for a verdict the server sends outside
   * `errors`. Cleared by the same rule as the rest.
   */
  setFieldError: (name: string, messages: string[]) => void
  /** Replace the form-level messages by hand, for a verdict the page words itself. */
  setFormErrors: (messages: string[]) => void
  /** Drop everything. Called at the start of each submit. */
  reset: () => void
}

export function useServerErrors(): ServerErrors {
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [formErrors, setFormErrors] = React.useState<string[]>([])

  const capture = React.useCallback((error: unknown) => {
    const fields = fieldErrorsFrom(error)
    const formLevel = formErrorsFrom(error)
    setFieldErrors(fields)
    // No detail at all (a 401, a 429, a 500, no response): the message is the
    // only account of the failure, so it is shown at form level.
    const hasDetail = Object.keys(fields).length > 0 || formLevel.length > 0
    setFormErrors(hasDetail ? formLevel : [messageFrom(error)])
  }, [])

  const clearField = React.useCallback((name: string) => {
    setFieldErrors((current) => {
      if (!(name in current)) return current
      // Only this field's verdict. A sibling's still stands: the user has not
      // touched it, so nothing the server said about it has changed.
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))
    })
  }, [])

  const setFieldError = React.useCallback((name: string, messages: string[]) => {
    // An updater, so it composes with a `capture` made in the same tick.
    setFieldErrors((current) => ({ ...current, [name]: messages }))
  }, [])

  const reset = React.useCallback(() => {
    setFieldErrors({})
    setFormErrors([])
  }, [])

  return { fieldErrors, formErrors, capture, clearField, setFieldError, setFormErrors, reset }
}

/**
 * Published by `<Form>` and read by `<FormField>` and `<FormError>`, so a page
 * wires server errors in one place instead of threading them field by field.
 */
export const ServerErrorsContext = React.createContext<ServerErrors | null>(null)
