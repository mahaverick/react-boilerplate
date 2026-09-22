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
import { ROLE_LABELS } from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useCreateTenant, useTenants, type TenantWithRole } from '@/queries/tenant.queries'
import { newTenantSchema, slugSchema } from '@/schemas/tenant.schemas'

export const Route = createFileRoute('/_app/tenants/')({
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

/**
 * What the list says when it could not be loaded.
 *
 * It states the failure rather than the absence, because those two are the
 * same rendered shape and only one of them is true. "You belong to none" is a
 * claim about the account; this is a claim about the request.
 */
const TENANTS_ERROR =
  'We could not load your tenants, so none are listed here. This is not a sign that you have none.'

function TenantRow({ entry }: { entry: TenantWithRole }) {
  return (
    <li>
      {/* The whole row is one link, so the tenant's name IS the link text —
          no "view" affordance beside a bare label. */}
      <Link
        to="/tenants/$slug"
        params={{ slug: entry.tenant.slug }}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 hover:bg-muted/50"
      >
        <span className="min-w-0">
          <span className="block font-medium">{entry.tenant.name}</span>
          <span className="block text-sm text-muted-foreground">/{entry.tenant.slug}</span>
        </span>
        {/* The role in words, not a colour: the badge is the only place this
            page states it. */}
        <Badge variant="secondary">{ROLE_LABELS[entry.role]}</Badge>
      </Link>
    </li>
  )
}

function CreateTenantCard() {
  const createTenant = useCreateTenant()
  const serverErrors = useServerErrors()

  // Annotated with the schema's INPUT type, not inferred from the literal:
  // the optional fields are `string | undefined` there, and TanStack requires
  // a validator whose input type is assignable to the form's values. Same
  // reasoning as `RegisterInput` in register.tsx.
  const defaultValues: z.input<typeof newTenantSchema> = { name: '', slug: '', description: '' }

  const form = useForm({
    defaultValues,
    // Whole-schema validation on SUBMIT only. Live feedback is per-field (see
    // the slug field below): a form-level `onChange` schema validates every
    // field on every keystroke, so typing one character into Slug rendered
    // "Name is required." under a Name the reader had not reached yet.
    validators: { onSubmit: newTenantSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // Parsed, not posted raw: TanStack hands `value` straight out of form
        // state, so without this the schema's `.trim()` never reaches the wire
        // and a blank description goes over as `''`, which the API refuses.
        const tenant = await createTenant.mutateAsync(newTenantSchema.parse(value))
        toast.success(`${tenant.name} created.`)
        form.reset()
      } catch (error) {
        serverErrors.capture(error)
        toast.error(messageFrom(error))
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

          {/* The one field that earns live validation: its shape — lowercase,
              hyphenated, 3-100, not reserved — is not one a reader can guess,
              and finding out at submit time is finding out too late. Scoped
              to this field, so it blames nothing else. */}
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

          {/* <Form> does not render this itself: schema-level server errors
              would go unseen without it. */}
          <FormError />

          <Button type="submit" disabled={createTenant.isPending}>
            {createTenant.isPending ? 'Creating…' : 'Create tenant'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  )
}

function TenantsPage() {
  const tenants = useTenants()

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          {/* CardTitle renders a div, so the page's h1 is nested inside it. */}
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
            // BEFORE the empty state, and that order is the whole point. A
            // failed load leaves `data` undefined, which is indistinguishable
            // from an account that genuinely belongs to nothing — so without
            // this branch a 500, or a 401 after the session ended underneath
            // this tab, rendered "You do not belong to any tenants yet.
            // Create one below." to someone who belongs to several, and
            // invited them to create a duplicate. See LoadError's own doc
            // comment: a screen must say what failed and offer a way back.
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
