import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
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
import { canManageTenant } from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import {
  useMyRole,
  useTenantSettings,
  useUpdateTenantSettings,
  type TenantSettings,
} from '@/queries/tenant.queries'
import { changedFieldsOf } from '@/schemas/changed-fields.schemas'
import { tenantSettingsFormSchema } from '@/schemas/tenant.schemas'

export const Route = createFileRoute('/_app/tenants/$slug/settings')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Settings · ${params.slug}`) }] }),
  staticData: { crumb: 'Settings' },
  component: TenantSettingsTab,
})

/**
 * What this tab says when the settings request failed, as opposed to the role
 * lookup. It has its own `refetch`, since `useMyRole`'s retry refetches the
 * tenant and would never re-issue the settings request.
 */
const SETTINGS_ERROR =
  'We could not load this tenant’s settings, so none are shown here. This is not a sign that it has none.'

/** `metadata` as a textarea holds it: pretty JSON, or empty for none. */
function metadataText(metadata: Record<string, unknown> | null): string {
  return metadata === null ? '' : JSON.stringify(metadata, null, 2)
}

/**
 * The settings form for owners and admins. Its schema's output is the PATCH
 * body: the metadata textarea parses to an object, or `null` to clear it. Only
 * the fields the user changed are checked and sent, so a stored value that
 * today's rules refuse does not block saving the others.
 */
function SettingsForm({ slug, settings }: { slug: string; settings: TenantSettings }) {
  const updateSettings = useUpdateTenantSettings(slug)
  const serverErrors = useServerErrors()

  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const defaultValues: z.input<typeof tenantSettingsFormSchema> = {
    timezone: settings.timezone,
    locale: settings.locale,
    metadata: metadataText(settings.metadata),
  }

  const changes = changedFieldsOf(tenantSettingsFormSchema, defaultValues)

  const form = useForm({
    defaultValues,
    validators: { onSubmit: changes },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await updateSettings.mutateAsync(changes.parse(value))
        toast.success('Settings updated.')
      } catch (error) {
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors}>
      <FormField form={form} name="timezone">
        {(field) => (
          <FormItem>
            <FormLabel>Timezone</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>A time zone name such as Europe/London.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="locale">
        {(field) => (
          <FormItem>
            <FormLabel>Locale</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>A tag such as en or en-GB. At most 10 characters.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="metadata">
        {(field) => (
          <FormItem>
            <FormLabel>Metadata</FormLabel>
            <FormControl>
              <Textarea
                className="font-mono"
                rows={8}
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>
              A JSON object. Leave it empty to clear it. Invalid JSON is caught here rather than
              coming back as an error with no field attached.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormError />

      <Button type="submit" disabled={updateSettings.isPending}>
        {updateSettings.isPending ? 'Saving…' : 'Save settings'}
      </Button>
    </Form>
  )
}

/** The same three values, for a member who may not change them. */
function SettingsDetails({ settings }: { settings: TenantSettings }) {
  return (
    <dl className="grid gap-4">
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">Timezone</dt>
        <dd>{settings.timezone}</dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">Locale</dt>
        <dd>{settings.locale}</dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">Metadata</dt>
        <dd>
          {settings.metadata === null ? (
            '—'
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {metadataText(settings.metadata)}
            </pre>
          )}
        </dd>
      </div>
    </dl>
  )
}

/**
 * The settings tab. A settings failure and a role failure render as stacked
 * errors, each retrying its own request, since either can fail alone. The form
 * is keyed on the row's `updatedAt`, so its defaults come from loaded data.
 */
function TenantSettingsTab() {
  const { slug } = Route.useParams()
  const settings = useTenantSettings(slug)
  const { role, isPending: isRolePending, isError: isRoleError, retry } = useMyRole(slug)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Settings</h2>
        </CardTitle>
        <CardDescription>
          {role && canManageTenant(role)
            ? 'Timezone, locale and free-form metadata for this tenant.'
            : 'These settings are managed by the tenant’s owners and admins.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isError || isRoleError || (!isRolePending && !role) ? (
          <div className="grid gap-3">
            {settings.isError && (
              <LoadError message={SETTINGS_ERROR} onRetry={() => void settings.refetch()} />
            )}
            {(isRoleError || (!isRolePending && !role)) && (
              <LoadError message={ROLE_ERROR} onRetry={retry} />
            )}
          </div>
        ) : settings.isPending || isRolePending || !role || !settings.data ? (
          <div className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : canManageTenant(role) ? (
          <SettingsForm key={settings.data.updatedAt} slug={slug} settings={settings.data} />
        ) : (
          <SettingsDetails settings={settings.data} />
        )}
      </CardContent>
    </Card>
  )
}
