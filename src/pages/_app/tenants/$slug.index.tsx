import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { canManageTenant } from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useMyRole, useTenant, useUpdateTenant, type Tenant } from '@/queries/tenant.queries'
import { updateTenantSchema } from '@/schemas/tenant.schemas'

export const Route = createFileRoute('/_app/tenants/$slug/')({
  staticData: { crumb: 'Overview' },
  component: TenantOverviewTab,
})

/** The tenant's creation date, in the reader's own locale. */
function createdOn(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)
}

/** One read-only row, for a member who may not edit this tenant. */
function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word">{value ?? '—'}</dd>
    </div>
  )
}

function TenantDetails({ tenant }: { tenant: Tenant }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <DetailRow label="Name" value={tenant.name} />
      <DetailRow label="Slug" value={tenant.slug} />
      <DetailRow label="Description" value={tenant.description} />
      <DetailRow label="Website" value={tenant.website} />
      <DetailRow label="Logo" value={tenant.logo} />
      <DetailRow label="Created" value={createdOn(tenant.createdAt)} />
    </dl>
  )
}

/**
 * The edit form. Owner and admin only — `PATCH /tenants/:slug` is gated
 * `requireRole('owner', 'admin')`.
 *
 * There is no slug field: the API's own `updateTenantSchema` omits it, so
 * the slug is immutable through this endpoint. An input that always 400s is
 * worse than no input.
 */
function EditTenantForm({ tenant }: { tenant: Tenant }) {
  const updateTenant = useUpdateTenant(tenant.slug)
  const serverErrors = useServerErrors()

  // The schema's INPUT type, not the literal's: every field is optional on a
  // PATCH body, and TanStack needs the validator's input assignable to the
  // form's values (register.tsx's `RegisterInput` annotation, same reason).
  const defaultValues: z.input<typeof updateTenantSchema> = {
    name: tenant.name,
    description: tenant.description ?? '',
    logo: tenant.logo ?? '',
    website: tenant.website ?? '',
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: updateTenantSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // Parsed, so an emptied box goes over as `null` — which CLEARS the
        // column. Posting `''` would be a 400; omitting the key would leave
        // the old value in place and quietly undo the edit.
        await updateTenant.mutateAsync(updateTenantSchema.parse(value))
        toast.success('Tenant updated.')
      } catch (error) {
        serverErrors.capture(error)
        toast.error(messageFrom(error))
      }
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
            <FormDescription>Leave empty to clear it.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="website">
        {(field) => (
          <FormItem>
            <FormLabel>Website</FormLabel>
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

      <FormField form={form} name="logo">
        {(field) => (
          <FormItem>
            <FormLabel>Logo URL</FormLabel>
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

      <FormError />

      <Button type="submit" disabled={updateTenant.isPending}>
        {updateTenant.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </Form>
  )
}

function TenantOverviewTab() {
  const { slug } = Route.useParams()
  const tenant = useTenant(slug)
  const { role, isPending: isRolePending } = useMyRole(slug)

  // The layout route above has already rendered the not-found panel in this
  // case; this tab simply has nothing to show.
  if (!tenant.data) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Overview</h2>
        </CardTitle>
        <CardDescription>
          {role && canManageTenant(role)
            ? 'Update this tenant. Its slug is fixed and cannot be changed.'
            : 'These details are managed by the tenant’s owners and admins.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Role unknown is LOADING, not "read-only": rendering the read-only
            view first would flash an owner's own form away from them. */}
        {isRolePending || !role ? (
          <div className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : canManageTenant(role) ? (
          // Keyed on the row, so the form's defaults are captured from real
          // data rather than from whatever arrived first.
          <EditTenantForm key={tenant.data.id} tenant={tenant.data} />
        ) : (
          <TenantDetails tenant={tenant.data} />
        )}
      </CardContent>
    </Card>
  )
}
