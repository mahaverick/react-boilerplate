import { useForm } from '@tanstack/react-form'
import { useId } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { useAuthProviders, useChangePassword, useRevokeOtherSessions } from '@/queries/auth.queries'
import { changePasswordSchema, type ChangePasswordInput } from '@/schemas/auth.schemas'
import type { AuthProviders } from '@/types/api.types'

const PASSWORD_CHANGED = 'Password changed. Other sessions were signed out.'
const PROVIDERS_ERROR = 'We could not load your sign-in methods.'
const GOOGLE_ONLY =
  'This account signs in with Google only. To add a password, use Forgot password on the sign-in page.'

/** What the other-sessions control says it does. */
const OTHER_SESSIONS_HINT =
  'Signs you out on every other browser and device. You stay signed in here.'

/**
 * The toast after other sessions were signed out.
 * @param revoked - How many sessions the API ended.
 */
function revokedMessage(revoked: number): string {
  if (revoked === 0) return 'No other sessions were signed in.'
  return `Signed out ${String(revoked)} other ${revoked === 1 ? 'session' : 'sessions'}.`
}

/** Display names by provider id. An id not listed here shows as itself. */
const PROVIDER_LABELS: Record<string, string> = { google: 'Google' }

/**
 * The API's change-password 400s about one field. They carry no `errors` map
 * and no `code`, so the message is the key (express auth.service.ts).
 */
const FIELD_FOR_MESSAGE = new Map<string, keyof ChangePasswordInput>([
  ['Current password is incorrect.', 'currentPassword'],
  ['New password must be different from the current password.', 'newPassword'],
])

/**
 * Sign-in methods, the change-password form and signing out other sessions,
 * below the profile form. Signing out other sessions is offered on every
 * account, a Google-only one included.
 */
export function SecuritySection() {
  const providers = useAuthProviders()
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="mt-6 grid gap-6 border-t pt-6">
      <h2 id={headingId} className="text-lg font-semibold">
        Security
      </h2>
      {providers.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : providers.isError ? (
        <LoadError message={PROVIDERS_ERROR} onRetry={() => void providers.refetch()} />
      ) : (
        <>
          <SignInMethods {...providers.data} />
          {providers.data.hasPassword ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-sm text-muted-foreground">{GOOGLE_ONLY}</p>
          )}
        </>
      )}
      <OtherSessions />
    </section>
  )
}

/**
 * Read-only: the API has no endpoint to unlink a method. A Google sign-up has
 * an 'email' row too, so `hasPassword` alone decides whether "Email &
 * password" is listed.
 */
function SignInMethods({ providers, hasPassword }: AuthProviders) {
  const linked = providers.filter((link) => link.provider !== 'email')

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Sign-in methods</h3>
      <ul className="grid gap-1 text-sm">
        {hasPassword && <li>Email &amp; password</li>}
        {linked.map((link) => (
          <li key={link.provider}>{PROVIDER_LABELS[link.provider] ?? link.provider}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "Sign out other sessions": one button, confirmed by a toast with the count,
 * as the change-password form confirms its own change. A failure shows the
 * server's message.
 */
function OtherSessions() {
  const revokeOthers = useRevokeOtherSessions()
  const hintId = useId()

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Other sessions</h3>
      <p id={hintId} className="text-sm text-muted-foreground">
        {OTHER_SESSIONS_HINT}
      </p>
      <div>
        <Button
          variant="outline"
          aria-describedby={hintId}
          disabled={revokeOthers.isPending}
          onClick={() => {
            revokeOthers.mutate(undefined, {
              onSuccess: ({ revoked }) => toast.success(revokedMessage(revoked)),
              onError: (error) => toast.error(messageFrom(error)),
            })
          }}
        >
          {revokeOthers.isPending ? 'Signing out…' : 'Sign out other sessions'}
        </Button>
      </div>
    </div>
  )
}

function ChangePasswordForm() {
  const changePassword = useChangePassword()
  const serverErrors = useServerErrors()

  const defaultValues: ChangePasswordInput = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: changePasswordSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await changePassword.mutateAsync(changePasswordSchema.parse(value))
        toast.success(PASSWORD_CHANGED)
        form.reset()
      } catch (error) {
        const field =
          statusFrom(error) === 400 ? FIELD_FOR_MESSAGE.get(messageFrom(error)) : undefined
        if (field) {
          serverErrors.setFieldError(field, [messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Change password</h3>
      <Form form={form} serverErrors={serverErrors}>
        <FormField form={form} name="currentPassword">
          {(field) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <FormField form={form} name="newPassword">
          {(field) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <FormField form={form} name="confirmPassword">
          {(field) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
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

        <Button type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending ? 'Changing…' : 'Change password'}
        </Button>
      </Form>
    </div>
  )
}
