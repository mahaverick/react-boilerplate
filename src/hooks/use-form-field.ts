import * as React from 'react'

/** What `<FormField>` publishes about its field: the name, the element ids and the validator issues. */
export interface FormFieldContextValue {
  name: string
  /** Raw validator issues. Standard Schema emits objects, not strings. */
  errors: unknown[]
  formItemId: string
  formMessageId: string
}

/** The context `<FormField>` publishes and the presentational form parts read. */
export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

/**
 * The enclosing field's context. It lives here with `FormFieldContext`, not in
 * `@/components/ui/form.tsx`, because `react-refresh/only-export-components`
 * rejects a hook exported, or re-exported, beside components.
 * @throws When called outside a `<FormField>`.
 */
export function useFormField(): FormFieldContextValue {
  const context = React.useContext(FormFieldContext)
  if (!context) throw new Error('useFormField must be used inside a <FormField>')
  return context
}

/**
 * The field's value as a string, for a controlled input. `AnyFieldApi` types
 * its value as `any`; this narrows it.
 */
export function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
