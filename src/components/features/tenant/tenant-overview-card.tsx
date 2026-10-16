import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { BusyButton } from '@/components/shared/busy-button'
import { FormFieldsSkeleton } from '@/components/shared/section-skeleton'
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
import { Textarea } from '@/components/ui/textarea'
import { canManageTenant } from '@/constants/roles'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useMyRole, useTenant, useUpdateTenant, type Tenant } from '@/queries/tenant.queries'
import { updateTenantSchema } from '@/schemas/tenant.schemas'

/** The tenant's creation date, in the reader's own locale. */
function createdOn(createdAt: string): string {
  return formatDate(createdAt, 'long') ?? 'Unknown'
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

/** The tenant's details as a read-only list, for members who may not edit them. */
export function TenantDetails({ tenant }: { tenant: Tenant }) {
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
 * The edit form. Owner and admin only: `PATCH /tenants/:slug` is gated
 * `requireRole('owner', 'admin')`. There is no slug field, since
 * `updateTenantSchema` omits it, as the server's does. Only the fields the
 * user changed from the row (as loaded until the first edit, blur or save
 * attempt, or as last saved) are checked and sent, so a stored value that
 * today's rules refuse does not block saving the others, and a refetch that
 * brings another admin's change does not send it back. With nothing changed,
 * Save sends nothing and asks for a change instead.
 * The changed fields are parsed before posting, so an emptied box goes over as
 * `null` and clears the column: `''` would be a 400, and an omitted key would
 * keep the old value.
 */
function EditTenantForm({ tenant }: { tenant: Tenant }) {
  const updateTenant = useUpdateTenant(tenant.slug)
  const serverErrors = useServerErrors()

  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const loaded: z.input<typeof updateTenantSchema> = {
    name: tenant.name,
    description: tenant.description ?? '',
    logo: tenant.logo ?? '',
    website: tenant.website ?? '',
  }
  const { baseline, changes, changedBody, listeners, rebase } = useChangedFields(
    updateTenantSchema,
    loaded,
    serverErrors,
    'Change a field before saving.'
  )

  const form = useForm({
    defaultValues: baseline,
    validators: { onSubmit: changes },
    listeners,
    onSubmit: async ({ value }) => {
      const body = changedBody(value)
      if (!body) return
      serverErrors.reset()
      try {
        await updateTenant.mutateAsync(body)
        rebase(value)
        toast.success('Tenant updated.')
      } catch (error) {
        serverErrors.capture(error)
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

      <BusyButton busy={updateTenant.isPending} busyLabel="Saving…" type="submit">
        Save changes
      </BusyButton>
    </Form>
  )
}

/**
 * The tenant's details card: the edit form for owners and admins, the
 * read-only details otherwise. An unknown role renders a skeleton, not the
 * read-only view, which would flash an owner's form away; a failed role
 * lookup renders an error with a retry. Keyed on the row, so the form's
 * defaults come from real data.
 */
export function TenantOverviewCard({ slug }: { slug: string }) {
  const tenant = useTenant(slug)
  const { role, isPending: isRolePending, isError: isRoleError, retry } = useMyRole(slug)
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
        {isRoleError || (!isRolePending && !role) ? (
          <LoadError message={ROLE_ERROR} onRetry={retry} />
        ) : isRolePending || !role ? (
          <FormFieldsSkeleton fields={4} />
        ) : canManageTenant(role) ? (
          <EditTenantForm key={tenant.data.id} tenant={tenant.data} />
        ) : (
          <TenantDetails tenant={tenant.data} />
        )}
      </CardContent>
    </Card>
  )
}
