import * as React from 'react'

/**
 * The context `<FormField>` publishes and the presentational form parts read.
 *
 * This lives here rather than beside the components in
 * `@/components/ui/form.tsx` because that file is linted (it is ours, not
 * vendored) and `react-refresh/only-export-components` rejects a hook
 * exported alongside components — including a re-export. `form.tsx` imports
 * from here and does not re-export.
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
 * The field's value as a string, for a controlled input.
 *
 * `AnyFieldApi` types its value as `any`, so reading it straight into JSX
 * leaks `any` through the no-unsafe-* rules. This is the one place that
 * narrowing happens.
 */
export function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
