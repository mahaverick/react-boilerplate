import { useRender } from '@base-ui/react/use-render'
import type { AnyFieldApi, AnyFormApi } from '@tanstack/react-form'
import * as React from 'react'
import { Label } from '@/components/ui/label'
import { FormFieldContext, useFormField, type FormFieldContextValue } from '@/hooks/use-form-field'
import { ServerErrorsContext, type ServerErrors } from '@/hooks/use-server-errors'
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
 *
 * Server-side validator detail is handled here too, once, rather than in each
 * page: pass `useServerErrors()` to `<Form>` and every field picks up its own
 * messages. See `@/hooks/use-server-errors`.
 */

/**
 * The form element itself. TanStack Form has no provider component.
 *
 * `onChange` is where a server verdict expires. It fires for every control in
 * the form (React's change event bubbles), and `FormControl` puts the field's
 * `name` on each control, so one handler here clears exactly the field the
 * user is fixing — not its siblings, whose verdicts are still true, and not on
 * blur, which is not the user changing anything.
 */
export function Form({
  form,
  serverErrors,
  className,
  children,
  ...props
}: React.ComponentProps<'form'> & { form: AnyFormApi; serverErrors?: ServerErrors }) {
  const element = (
    <form
      noValidate
      className={cn('space-y-4', className)}
      onChange={(event) => {
        const { name } = event.target as Partial<HTMLInputElement>
        if (name) serverErrors?.clearField(name)
      }}
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
  if (!serverErrors) return element
  return <ServerErrorsContext.Provider value={serverErrors}>{element}</ServerErrorsContext.Provider>
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
  const serverErrors = React.useContext(ServerErrorsContext)
  const serverMessages = serverErrors?.fieldErrors[name]
  const errors = field.state.meta.errors as unknown[]
  const value = React.useMemo<FormFieldContextValue>(
    () => ({
      name,
      // Client issues first: they describe what is in the control right now.
      // The server's verdict follows it and survives until this field changes.
      errors: serverMessages ? [...errors, ...serverMessages] : errors,
      formItemId: `${id}-item`,
      formMessageId: `${id}-message`,
    }),
    [name, errors, serverMessages, id]
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
  const { name, errors, formItemId, formMessageId } = useFormField()
  const hasError = errors.length > 0
  return useRender({
    render: children,
    props: {
      id: formItemId,
      // Not decoration: `<Form>`'s change handler reads this to know which
      // field's server error to drop.
      name,
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

/**
 * The server's schema-level messages — the `errors` map's reserved
 * `formErrors` key, which names no field.
 *
 * Rendered at form level, above the submit button. Attaching these to an
 * input called "formErrors" would put an error against a field no form has.
 */
export function FormError({ className, ...props }: React.ComponentProps<'div'>) {
  const serverErrors = React.useContext(ServerErrorsContext)
  const messages = serverErrors?.formErrors ?? []
  if (messages.length === 0) return null
  return (
    <div role="alert" className={cn('text-sm text-destructive', className)} {...props}>
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  )
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
