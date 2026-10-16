import { IconBuilding } from '@tabler/icons-react'
import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, type Ref } from 'react'
import { z } from 'zod'
import { MyTenantsTable } from '@/components/features/tenant/my-tenants-table'
import { BusyButton } from '@/components/shared/busy-button'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
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
import { Textarea } from '@/components/ui/textarea'
import { pageTitle } from '@/constants/app'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { toast } from '@/lib/toast'
import { myTenantsList, myTenantsListOptions, useCreateTenant } from '@/queries/tenant.queries'
import { newTenantSchema, slugSchema } from '@/schemas/tenant.schemas'

/** The caller's tenant list and the form to create another. */
export const Route = createFileRoute('/_app/tenants/')({
  validateSearch: myTenantsList.schema,
  staticData: { crumb: 'Tenants' },
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  component: TenantsPage,
})

/** What the list says when it could not be loaded: a claim about the request, not the account. */
const TENANTS_ERROR =
  'We could not load your tenants, so none are listed here. This is not a sign that you have none.'

/**
 * The create-tenant form. The whole schema validates on submit only, so typing
 * in one field never blames another; the slug alone validates live, since its
 * shape is not one a reader can guess. The value is parsed before posting, so
 * the schema's trimming reaches the wire and a blank description is dropped
 * rather than sent as `''`, which the API refuses. `<FormError />` shows
 * schema-level server errors, which `<Form>` does not render itself.
 */
function CreateTenantCard({ cardRef }: { cardRef: Ref<HTMLDivElement> }) {
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
    <Card ref={cardRef}>
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

          <BusyButton busy={createTenant.isPending} busyLabel="Creating…" type="submit">
            Create tenant
          </BusyButton>
        </Form>
      </CardContent>
    </Card>
  )
}

/**
 * The tenant list and the create form. The list's loading, error and empty
 * states are `DataTable`'s: a failed load is never the empty state, since the
 * two render alike and an empty state would invite the reader to create a
 * duplicate.
 */
function TenantsPage() {
  const list = useListSearch(myTenantsList)
  const tenants = useListQuery(list, myTenantsListOptions)
  const createCard = useRef<HTMLDivElement>(null)

  /** Brings the create form into view and puts the cursor in its first field. */
  const showCreateForm = () => {
    createCard.current?.scrollIntoView({ block: 'center' })
    createCard.current?.querySelector('input')?.focus()
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Tenants</h1>
          </CardTitle>
          <CardDescription>Every organization this account belongs to.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyTenantsTable
            query={tenants}
            errorMessage={TENANTS_ERROR}
            empty={
              <EmptyState
                icon={<IconBuilding aria-hidden="true" />}
                title="You do not belong to any tenants yet."
                description="Create one below."
                action={
                  <Button variant="outline" size="sm" onClick={showCreateForm}>
                    Create a tenant
                  </Button>
                }
              />
            }
          />
        </CardContent>
      </Card>
      <CreateTenantCard cardRef={createCard} />
    </div>
  )
}
