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
import { useAuthProviders, useChangePassword } from '@/queries/auth.queries'
import { changePasswordSchema, type ChangePasswordInput } from '@/schemas/auth.schemas'
import type { AuthProviders } from '@/types/api.types'

const PASSWORD_CHANGED = 'Password changed. Other sessions were signed out.'
const PROVIDERS_ERROR = 'We could not load your sign-in methods.'
const GOOGLE_ONLY =
  'This account signs in with Google only. To add a password, use Forgot password on the sign-in page.'

/** Display names by provider id. An id not listed here shows as itself. */
const PROVIDER_LABELS: Record<string, string> = { google: 'Google' }

/**
 * The API's 400s about one field. They carry no `errors` map and no `code`,
 * so the message is the key; these are `changePassword`'s in express's auth.service.ts.
 */
const FIELD_FOR_MESSAGE = new Map<string, keyof ChangePasswordInput>([
  ['Current password is incorrect.', 'currentPassword'],
  ['New password must be different from the current password.', 'newPassword'],
])

/** Sign-in methods and the change-password form, below the profile form. */
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
    </section>
  )
}

/** Read-only: the API has no endpoint to unlink a method. */
function SignInMethods({ providers, hasPassword }: AuthProviders) {
  // A Google sign-up has an 'email' row too, so `hasPassword` alone decides
  // whether "Email & password" is listed.
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
