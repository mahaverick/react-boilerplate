import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { Badge } from '@/components/ui/badge'
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
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useCreateTenant, useTenants, type TenantWithRole } from '@/queries/tenant.queries'
import { newTenantSchema, slugSchema } from '@/schemas/tenant.schemas'

export const Route = createFileRoute('/_app/tenants/')({
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

/** What the list says when it could not be loaded: a claim about the request, not the account. */
const TENANTS_ERROR =
  'We could not load your tenants, so none are listed here. This is not a sign that you have none.'

/**
 * One tenant: the whole row is one link, and the role badge states the role in
 * words. A suspended tenant's own routes answer 404, so its row is not a link:
 * it says "Suspended" instead of leading to a dead end.
 */
function TenantRow({ entry }: { entry: TenantWithRole }) {
  const suspended = entry.tenant.lifecycleState === 'suspended'
  const content = (
    <>
      <span className="min-w-0">
        <span className="block font-medium">{entry.tenant.name}</span>
        <span className="block text-sm text-muted-foreground">/{entry.tenant.slug}</span>
      </span>
      <span className="flex items-center gap-2">
        {suspended && <Badge variant="outline">Suspended</Badge>}
        <Badge variant="secondary">{ROLE_LABELS[entry.role]}</Badge>
      </span>
    </>
  )
  const rowClass = 'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3'
  return (
    <li>
      {suspended ? (
        <div className={`${rowClass} text-muted-foreground`}>{content}</div>
      ) : (
        <Link
          to="/tenants/$slug"
          params={{ slug: entry.tenant.slug }}
          className={`${rowClass} hover:bg-muted/50`}
        >
          {content}
        </Link>
      )}
    </li>
  )
}

/**
 * The create-tenant form. The whole schema validates on submit only, so typing
 * in one field never blames another; the slug alone validates live, since its
 * shape is not one a reader can guess. The value is parsed before posting, so
 * the schema's trimming reaches the wire and a blank description is dropped
 * rather than sent as `''`, which the API refuses. `<FormError />` shows
 * schema-level server errors, which `<Form>` does not render itself.
 */
function CreateTenantCard() {
  const createTenant = useCreateTenant()
  const serverErrors = useServerErrors()

  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const defaultValues: z.input<typeof newTenantSchema> = { name: '', slug: '', description: '' }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: newTenantSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        const tenant = await createTenant.mutateAsync(newTenantSchema.parse(value))
        toast.success(`${tenant.name} created.`)
        form.reset()
      } catch (error) {
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Create a tenant</h2>
        </CardTitle>
        <CardDescription>You become its owner. The slug cannot be changed later.</CardDescription>
      </CardHeader>
      <CardContent>
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
                  Lowercase letters, numbers and hyphens. This becomes the tenant&apos;s address:
                  /tenants/your-slug. Capitals are rejected rather than converted, so the slug you
                  type is the one you get.
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

          <Button type="submit" disabled={createTenant.isPending}>
            {createTenant.isPending ? 'Creating…' : 'Create tenant'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  )
}

/**
 * The tenant list and the create form. The error branch comes before the empty
 * one, since a failed load and an account with no tenants render alike, and an
 * empty state would invite the reader to create a duplicate.
 */
function TenantsPage() {
  const tenants = useTenants()

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Tenants</h1>
          </CardTitle>
          <CardDescription>Every organization this account belongs to.</CardDescription>
        </CardHeader>
        <CardContent>
          {tenants.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : tenants.isError ? (
            <LoadError message={TENANTS_ERROR} onRetry={() => void tenants.refetch()} />
          ) : tenants.data && tenants.data.length > 0 ? (
            <ul className="grid gap-2">
              {tenants.data.map((entry) => (
                <TenantRow key={entry.tenant.id} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              You do not belong to any tenants yet. Create one below.
            </p>
          )}
        </CardContent>
      </Card>
      <CreateTenantCard />
    </div>
  )
}
