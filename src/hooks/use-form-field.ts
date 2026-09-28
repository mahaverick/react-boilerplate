import * as React from 'react'

/**
 * The context `<FormField>` publishes and the presentational form parts read.
 * It lives here, not in `@/components/ui/form.tsx`, because
 * `react-refresh/only-export-components` rejects a hook exported, or
 * re-exported, beside components.
 */
export interface FormFieldContextValue {
  name: string
  /** Raw validator issues. Standard Schema emits objects, not strings. */
  errors: unknown[]
  formItemId: string
  formMessageId: string
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

export function useFormField(): FormFieldContextValue {
  const context = React.useContext(FormFieldContext)
  if (!context) throw new Error('useFormField must be used inside a <FormField>')
  return context
}

/**
 * The field's value as a string, for a controlled input. `AnyFieldApi` types
 * its value as `any`, and this is the one place it is narrowed.
 */
export function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
