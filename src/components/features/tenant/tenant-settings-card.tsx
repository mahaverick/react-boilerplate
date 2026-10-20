import '@/lib/zod-jitless'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { BusyButton } from '@/components/shared/busy-button'
import { QueryState } from '@/components/shared/query-state'
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
import { toast } from '@/lib/toast'
import { useTenantSettings, useUpdateTenantSettings } from '@/queries/tenant-forms.queries'
import { useMyRole, type TenantSettings } from '@/queries/tenant.queries'
import { MAX_TENANT_METADATA_LENGTH, tenantSettingsFormSchema } from '@/schemas/tenant.schemas'

/**
 * What this tab says when the settings request failed, as opposed to the role
 * lookup. It has its own `refetch`, since `useMyRole`'s retry refetches the
 * tenant and would never re-issue the settings request.
 */
const SETTINGS_ERROR =
  'We couldn’t load this tenant’s settings, so none are shown. Try again to load them.'

/** `metadata` as a textarea holds it: pretty JSON, or empty for none. */
function metadataText(metadata: Record<string, unknown> | null): string {
  return metadata === null ? '' : JSON.stringify(metadata, null, 2)
}

/**
 * The settings form for owners and admins. Its schema's output is the PATCH
 * body: the metadata textarea parses to an object, or `null` to clear it. Only
 * the fields the user changed from the stored values (as loaded until the
 * first edit, blur or save attempt, or as last saved) are checked and sent, so
 * a stored value that today's rules refuse does not block saving the others.
 * With nothing changed, Save sends nothing and asks for a change instead.
 */
function SettingsForm({ slug, settings }: { slug: string; settings: TenantSettings }) {
  const updateSettings = useUpdateTenantSettings(slug)
  const serverErrors = useServerErrors()

  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const loaded: z.input<typeof tenantSettingsFormSchema> = {
    timezone: settings.timezone,
    locale: settings.locale,
    metadata: metadataText(settings.metadata),
  }
  const { baseline, changes, changedBody, listeners, rebase } = useChangedFields(
    tenantSettingsFormSchema,
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
        await updateSettings.mutateAsync(body)
        rebase(value)
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
              A JSON (JavaScript Object Notation) object of at most{' '}
              {MAX_TENANT_METADATA_LENGTH.toLocaleString('en-US')} characters. Leave it empty to
              clear it.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormError />

      <BusyButton busy={updateSettings.isPending} busyLabel="Saving…" type="submit">
        Save settings
      </BusyButton>
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
 * errors, each retrying its own request, since either can fail alone. Settings
 * that land before the role keep the form's skeleton. The form
 * is keyed on the row's `updatedAt`, so its defaults come from loaded data.
 */
export function TenantSettingsCard({ slug }: { slug: string }) {
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
        <div className="grid gap-3">
          {(isRoleError || (!isRolePending && !role)) && (
            <LoadError message={ROLE_ERROR} onRetry={retry} />
          )}
          <QueryState
            query={settings}
            name="Settings"
            errorMessage={SETTINGS_ERROR}
            skeleton={<FormFieldsSkeleton fields={3} />}
          >
            {(data) =>
              isRolePending ? (
                <FormFieldsSkeleton fields={3} />
              ) : role === undefined ? null : canManageTenant(role) ? (
                <SettingsForm key={data.updatedAt} slug={slug} settings={data} />
              ) : (
                <SettingsDetails settings={data} />
              )
            }
          </QueryState>
        </div>
      </CardContent>
    </Card>
  )
}
