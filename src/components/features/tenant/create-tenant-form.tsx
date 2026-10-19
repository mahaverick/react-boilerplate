import '@/lib/zod-jitless'
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { z } from 'zod'
import { BusyButton } from '@/components/shared/busy-button'
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { useCreateTenant } from '@/queries/tenant-forms.queries'
import type { Tenant } from '@/queries/tenant.queries'
import { newTenantSchema, slugSchema } from '@/schemas/tenant.schemas'
import { SLUG_TAKEN } from '@/types/api.types'

/** What the create form says on its button, and what it does with the new tenant. */
interface CreateTenantFormProps {
  submitLabel: string
  busyLabel: string
  /** Runs after the create succeeds; the form resets once it resolves. */
  onCreated: (tenant: Tenant) => void | Promise<void>
}

/**
 * The create-tenant form: Name, Slug and Description. The whole schema
 * validates on submit only, so typing in one field never blames another; the
 * slug alone validates live, since its shape is not one a reader can guess.
 * The value is parsed before posting, so the schema's trimming reaches the
 * wire and a blank description is dropped rather than sent as `''`, which the
 * API refuses. The API's `slug_taken` names no field in its envelope, so it is
 * put under Slug by hand. `<FormError />` shows schema-level server errors,
 * which `<Form>` does not render itself.
 */
export function CreateTenantForm({ submitLabel, busyLabel, onCreated }: CreateTenantFormProps) {
  const createTenant = useCreateTenant()
  const serverErrors = useServerErrors()
  // Busy until `onCreated` resolves too, so a second click cannot post again while the caller lands.
  const [landing, setLanding] = useState(false)

  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const defaultValues: z.input<typeof newTenantSchema> = { name: '', slug: '', description: '' }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: newTenantSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      let tenant: Tenant
      try {
        tenant = await createTenant.mutateAsync(newTenantSchema.parse(value))
      } catch (error) {
        if (codeFrom(error) === SLUG_TAKEN) {
          serverErrors.setFieldError('slug', [messageFrom(error)])
          return
        }
        serverErrors.capture(error)
        return
      }
      setLanding(true)
      try {
        await onCreated(tenant)
      } finally {
        setLanding(false)
      }
      form.reset()
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors}>
      <FormField form={form} name="name">
        {(field) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="slug" validators={{ onChange: slugSchema }}>
        {(field) => (
          <FormItem>
            <FormLabel>Slug</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>
              Use lowercase letters, numbers and hyphens. The slug becomes the address:
              /tenants/your-slug. The form refuses capitals instead of converting them.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="description">
        {(field) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>Optional.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormError />

      <BusyButton busy={createTenant.isPending || landing} busyLabel={busyLabel} type="submit">
        {submitLabel}
      </BusyButton>
    </Form>
  )
}
