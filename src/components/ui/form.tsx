import { useRender } from '@base-ui/react/use-render'
import type { AnyFieldApi, AnyFormApi } from '@tanstack/react-form'
import * as React from 'react'
import { Label } from '@/components/ui/label'
import { FormFieldContext, useFormField, type FormFieldContextValue } from '@/hooks/use-form-field'
import { cn } from '@/lib/utils'

/**
 * The shadcn `form` component, rewritten against TanStack Form.
 *
 * The registry entry cannot be used: it is built on react-hook-form, which
 * this project does not install. The export surface is the same, so call
 * sites read exactly like upstream's.
 *
 * `useFormField` and `FormFieldContext` live in `@/hooks/use-form-field`
 * because this file is linted and `react-refresh/only-export-components`
 * rejects a non-component export beside components — a re-export included.
 */

/** The form element itself. TanStack Form has no provider component. */
export function Form({
  form,
  className,
  children,
  ...props
}: React.ComponentProps<'form'> & { form: AnyFormApi }) {
  return (
    <form
      noValidate
      className={cn('space-y-4', className)}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      {...props}
    >
      {children}
    </form>
  )
}

/**
 * `AnyFormApi` is `form-core`'s `FormApi`, which has no `Field` — that is
 * added by react-form's `useForm`. Narrowing to just the shape used here
 * keeps `FormField` usable with any form without threading ten generics
 * through every page.
 */
type FieldComponent = React.ComponentType<{
  name: string
  children: (field: AnyFieldApi) => React.ReactNode
}>

/**
 * Bridges one TanStack field into the context the presentational parts read.
 * The provider is its own component because it calls useId, and hooks
 * cannot be called inside a render-prop callback.
 */
export function FormField({
  form,
  name,
  children,
}: {
  form: AnyFormApi
  name: string
  children: (field: AnyFieldApi) => React.ReactNode
}) {
  const Field = (form as unknown as { Field: FieldComponent }).Field
  return React.createElement(Field, {
    name,
    children: (field: AnyFieldApi) => (
      <FieldProvider name={name} field={field}>
        {children(field)}
      </FieldProvider>
    ),
  })
}

function FieldProvider({
  name,
  field,
  children,
}: {
  name: string
  field: AnyFieldApi
  children: React.ReactNode
}) {
  const id = React.useId()
  const errors = field.state.meta.errors as unknown[]
  const value = React.useMemo<FormFieldContextValue>(
    () => ({
      name,
      errors,
      formItemId: `${id}-item`,
      formMessageId: `${id}-message`,
    }),
    [name, errors, id]
  )
  return <FormFieldContext.Provider value={value}>{children}</FormFieldContext.Provider>
}

export function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-2', className)} {...props} />
}

export function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { errors, formItemId } = useFormField()
  return (
    <Label
      htmlFor={formItemId}
      data-error={errors.length > 0}
      className={cn('data-[error=true]:text-destructive', className)}
      {...props}
    />
  )
}

/**
 * Wires the id and the aria wiring onto whatever control it is given.
 *
 * Base UI has no `Slot` component — `useRender` is its equivalent, and this
 * is the same call shape the vendored primitives (breadcrumb, badge) use.
 */
export function FormControl({ children }: { children: React.ReactElement }) {
  const { errors, formItemId, formMessageId } = useFormField()
  const hasError = errors.length > 0
  return useRender({
    render: children,
    props: {
      id: formItemId,
      'aria-describedby': hasError ? formMessageId : undefined,
      'aria-invalid': hasError,
    },
  })
}

export function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

/**
 * Reads `.message` because Standard Schema validators (Zod 4) emit issue
 * objects, not strings — but a validator is free to emit a bare string, so
 * both are handled.
 */
function issueText(issue: unknown): string {
  if (typeof issue === 'string') return issue
  if (typeof issue === 'object' && issue !== null && 'message' in issue) {
    const { message } = issue
    if (typeof message === 'string') return message
  }
  return ''
}

/** Renders the first error, if any. */
export function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { errors, formMessageId } = useFormField()
  const text = issueText(errors[0])
  if (!text) return null
  return (
    <p
      id={formMessageId}
      role="alert"
      className={cn('text-sm text-destructive', className)}
      {...props}
    >
      {text}
    </p>
  )
}
