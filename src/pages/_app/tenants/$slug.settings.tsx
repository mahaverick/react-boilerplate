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
import { canManageTenant } from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import {
  useMyRole,
  useTenantSettings,
  useUpdateTenantSettings,
  type TenantSettings,
} from '@/queries/tenant.queries'
import { tenantSettingsFormSchema } from '@/schemas/tenant.schemas'

export const Route = createFileRoute('/_app/tenants/$slug/settings')({
  staticData: { crumb: 'Settings' },
  component: TenantSettingsTab,
})

/**
 * What this tab says when the SETTINGS row itself failed, as opposed to the
 * role lookup.
 *
 * Its own message and its own `refetch`, for the reason spelled out on
 * `MEMBERS_ERROR` in the members tab: `useMyRole`'s retry refetches the tenant
 * itself, so handing it to a settings failure would produce a Try again that
 * issued no further settings request, under a sentence about a query that had
 * succeeded.
 */
const SETTINGS_ERROR =
  'We could not load this tenant’s settings, so none are shown here. This is not a sign that it has none.'

/** `metadata` as a textarea holds it: pretty JSON, or empty for none. */
function metadataText(metadata: Record<string, unknown> | null): string {
  return metadata === null ? '' : JSON.stringify(metadata, null, 2)
}

function SettingsForm({ slug, settings }: { slug: string; settings: TenantSettings }) {
  const updateSettings = useUpdateTenantSettings(slug)
  const serverErrors = useServerErrors()

  // The schema's INPUT type: `timezone` and `locale` are optional there, and
  // TanStack needs the validator's input assignable to the form's values.
  const defaultValues: z.input<typeof tenantSettingsFormSchema> = {
    timezone: settings.timezone,
    locale: settings.locale,
    metadata: metadataText(settings.metadata),
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: tenantSettingsFormSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // The form schema's output IS the PATCH body: it parses the metadata
        // textarea into an object (or `null`, which clears the column) so
        // this page never posts a string where the API wants JSON.
        await updateSettings.mutateAsync(tenantSettingsFormSchema.parse(value))
        toast.success('Settings updated.')
      } catch (error) {
        serverErrors.capture(error)
        toast.error(messageFrom(error))
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
            <FormDescription>
              An IANA name such as Europe/London. The API stores it as written and does not check it
              against a zone database — neither does this form, so that the two agree.
            </FormDescription>
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
          // STACKED, not chained — see the members tab: two independent
          // queries, either of which can fail alone, and a single branch would
          // offer a retry that cannot reach the query that actually failed.
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
          // Keyed so the defaults come from the loaded row, not from the
          // placeholder that rendered first.
          <SettingsForm key={settings.data.updatedAt} slug={slug} settings={settings.data} />
        ) : (
          <SettingsDetails settings={settings.data} />
        )}
      </CardContent>
    </Card>
  )
}
