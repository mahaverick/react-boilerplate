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
 * Tracks whether a `<FormError>` is mounted inside this form, so `<Form>` can
 * say something in dev when form-level errors would otherwise go unrendered.
 * Deliberately not exported: this file is linted, and a non-component export
 * here trips `react-refresh/only-export-components`.
 */
interface FormErrorSlot {
  /** Called by a mounted `<FormError>`; returns its own deregistration. */
  register: () => () => void
  isMounted: () => boolean
}

const FormErrorSlotContext = React.createContext<FormErrorSlot | null>(null)

/**
 * The form element itself. TanStack Form has no provider component.
 *
 * `onChange` is where a server verdict expires. It fires for every NATIVE
 * control in the form — `input`, `textarea`, `select` — because their change
 * event bubbles, and `FormControl` puts the field's `name` on each control, so
 * one handler here clears exactly the field the user is fixing: not its
 * siblings, whose verdicts are still true, and not on blur, which is not the
 * user changing anything.
 *
 * THE RULE DOES NOT COVER A BASE UI SELECT, and that is measured, not
 * suspected. Base UI's Select sets its hidden input programmatically, so
 * choosing an option emits NO change event that reaches this handler — a probe
 * watching `clearField` saw a plain `<input>` in the same form call it
 * immediately and the Select never call it at all, while the selection itself
 * plainly worked (the hidden input's value and the trigger's text both
 * changed). A server error on such a field would therefore sit there,
 * unchallenged, while the user changes the very control it is about.
 *
 * **Any non-native control must call `serverErrors.clearField('<its name>')`
 * itself, in its own change handler.** `src/pages/_app/tenants/$slug.members.tsx`
 * is the worked example: the add-member role Select calls it inside
 * `onValueChange`, and a test fails if that line is removed.
 *
 * Base UI's CHECKBOX IS UNVERIFIED. Nothing in this project wires one into a
 * form yet, so it was never probed, and it is NOT safe to assume it behaves
 * like the Select or like a native input — measure it before relying on either
 * answer. (What IS known about the Checkbox is a separate problem, recorded on
 * `FormControl` below: its `id` lands on the hidden input.)
 *
 * A caller's own `onChange`/`onSubmit` is pulled out of `props` and called
 * AFTER ours rather than spread over them: `{...props}` last would let a page
 * silently turn off either the clearing rule or submission itself.
 */
export function Form({
  form,
  serverErrors,
  className,
  children,
  onChange,
  onSubmit,
  ...props
}: React.ComponentProps<'form'> & { form: AnyFormApi; serverErrors?: ServerErrors }) {
  // A pair of functions over a closure variable, not a mutable object: a
  // consumer may not modify a value it got from useContext
  // (`react-hooks/immutability`), but it may call one.
  const [errorSlot] = React.useState<FormErrorSlot>(() => {
    let mounted = false
    return {
      register: () => {
        mounted = true
        return () => {
          mounted = false
        }
      },
      isMounted: () => mounted,
    }
  })
  const formErrors = serverErrors?.formErrors

  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!formErrors || formErrors.length === 0 || errorSlot.isMounted()) return
    // Child effects run before parent effects, so a mounted <FormError> has
    // already registered by now.
    console.warn(
      "<Form> was given form-level server errors (the `errors` map's reserved " +
        '`formErrors` key) but no <FormError> is mounted to render them, so the ' +
        'user sees nothing. Place <FormError /> above the submit button.',
      formErrors
    )
  }, [formErrors, errorSlot])

  const element = (
    <form
      noValidate
      className={cn('space-y-4', className)}
      onChange={(event) => {
        const { name } = event.target as Partial<HTMLInputElement>
        if (name) serverErrors?.clearField(name)
        onChange?.(event)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
        onSubmit?.(event)
      }}
      {...props}
    >
      {children}
    </form>
  )
  if (!serverErrors) return element
  return (
    <ServerErrorsContext.Provider value={serverErrors}>
      <FormErrorSlotContext.Provider value={errorSlot}>{element}</FormErrorSlotContext.Provider>
    </ServerErrorsContext.Provider>
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
  validators?: FieldValidators
  children: (field: AnyFieldApi) => React.ReactNode
}>

/**
 * Validators for ONE field, passed straight through to TanStack's `Field`.
 *
 * Each value is a Standard Schema (a Zod schema, in this project) or a
 * validator function. Typed as `unknown` for the same reason `FieldComponent`
 * above is hand-rolled: naming the real generic types would thread ten
 * parameters through every page, and this bridge's whole job is to keep them
 * out of the call sites.
 */
interface FieldValidators {
  onChange?: unknown
  onBlur?: unknown
  onSubmit?: unknown
}

/**
 * Bridges one TanStack field into the context the presentational parts read.
 * The provider is its own component because it calls useId, and hooks
 * cannot be called inside a render-prop callback.
 *
 * `validators` is this field's OWN. It is what live feedback should be
 * written with: a form-level `onChange` schema validates every field on every
 * keystroke, so typing the first character of one field renders "required"
 * under another the reader has not reached yet. Per-field, the message
 * appears against the field being edited and nowhere else. The form-level
 * `onSubmit` schema still has the last word, so nothing escapes by being
 * untouched.
 */
export function FormField({
  form,
  name,
  validators,
  children,
}: {
  form: AnyFormApi
  name: string
  validators?: FieldValidators
  children: (field: AnyFieldApi) => React.ReactNode
}) {
  const Field = (form as unknown as { Field: FieldComponent }).Field
  return React.createElement(Field, {
    name,
    validators,
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
 *
 * WHERE THE `id` ACTUALLY LANDS depends on the control, and the answer decides
 * whether `<FormLabel htmlFor>` points at something a pointer can reach:
 *
 * - Native `input`/`textarea`: on the control. Fine.
 * - Base UI **Select**: wrap this around `SelectTrigger` (inside `Select.Root`,
 *   which carries the `name`) and the id lands on the VISIBLE
 *   `button[role="combobox"]`. Measured, and asserted in
 *   `src/pages/_app/tenants/$slug.members.tsx`'s test.
 * - Base UI **Checkbox**: reported to land on the HIDDEN input rather than the
 *   visible `role="checkbox"` element, which would leave the label pointing at
 *   a control nobody can click. Carried from an earlier review and NOT
 *   re-measured here — nothing in this project wires a Checkbox into a form.
 *   Measure it before trusting it in either direction.
 *
 * Separately, see `<Form>` above for which controls the server-error CLEARING
 * rule reaches: a Base UI Select's change does not bubble, so such a control
 * must clear its own field.
 */
export function FormControl({ children }: { children: React.ReactElement<{ name?: string }> }) {
  const { name, errors, formItemId, formMessageId } = useFormField()
  const hasError = errors.length > 0
  const ownName = children.props.name

  if (import.meta.env.DEV && ownName !== undefined && ownName !== name) {
    console.warn(
      `<FormControl> is replacing the control's own name "${ownName}" with the ` +
        `field's name "${name}". <Form> reads that name to decide whose server ` +
        `error to clear, so a control naming itself something else would clear ` +
        `the wrong field. Remove the name prop.`
    )
  }

  // Cloned so the injected name WINS. useRender lets the rendered element's
  // own props override the ones passed below, which would otherwise hand the
  // clearing rule a name that belongs to no field. Cloned UNCONDITIONALLY:
  // `<Input name={undefined} />` still carries the key, and it overrides the
  // injected name with nothing, which is the same bug wearing a disguise.
  const control = React.cloneElement(children, { name })

  return useRender({
    render: control,
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
  const slot = React.useContext(FormErrorSlotContext)

  // Registered whether or not there is anything to show, so <Form>'s dev
  // warning fires only when this component is genuinely absent.
  React.useEffect(() => slot?.register(), [slot])

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
