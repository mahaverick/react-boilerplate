import * as React from 'react'
import { flushSync } from 'react-dom'
import { fieldErrorsFrom, formErrorsFrom, messageFrom } from '@/lib/api-error'

/**
 * The backend's validator detail, held for as long as it is still true: inline
 * errors under each field, mapped from the envelope's `errors`. Its reserved
 * `formErrors` key names no field, so those messages are kept apart and
 * rendered by `<FormError>` at form level. `@/lib/api-error` does the splitting.
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

/**
 * Server errors for one form. `capture`, `setFieldError` and `setFormErrors`
 * commit through `flushSync`: they run in a submit's promise continuation, and
 * `<Form>` focuses the first `aria-invalid` control once that submit settles,
 * so the error must already be in the DOM. With no detail at all (a 401, 429,
 * 500 or no response), `capture` shows the response's message at form level.
 * `clearField` drops only that field's messages; a sibling's still stands.
 */
export function useServerErrors(): ServerErrors {
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [formErrors, setFormErrorsState] = React.useState<string[]>([])

  const capture = React.useCallback((error: unknown) => {
    const fields = fieldErrorsFrom(error)
    const formLevel = formErrorsFrom(error)
    const hasDetail = Object.keys(fields).length > 0 || formLevel.length > 0
    flushSync(() => {
      setFieldErrors(fields)
      setFormErrorsState(hasDetail ? formLevel : [messageFrom(error)])
    })
  }, [])

  const clearField = React.useCallback((name: string) => {
    setFieldErrors((current) => {
      if (!(name in current)) return current
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))
    })
  }, [])

  const setFieldError = React.useCallback((name: string, messages: string[]) => {
    // An updater, so it composes with a `capture` made in the same tick.
    flushSync(() => {
      setFieldErrors((current) => ({ ...current, [name]: messages }))
    })
  }, [])

  const setFormErrors = React.useCallback((messages: string[]) => {
    flushSync(() => {
      setFormErrorsState(messages)
    })
  }, [])

  const reset = React.useCallback(() => {
    setFieldErrors({})
    setFormErrorsState([])
  }, [])

  return { fieldErrors, formErrors, capture, clearField, setFieldError, setFormErrors, reset }
}

/**
 * Published by `<Form>` and read by `<FormField>` and `<FormError>`, so a page
 * wires server errors in one place instead of threading them field by field.
 */
export const ServerErrorsContext = React.createContext<ServerErrors | null>(null)
