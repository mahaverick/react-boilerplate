import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { BusyButton } from '@/components/shared/busy-button'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { buttonVariants } from '@/components/ui/button'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
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
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useResetPassword } from '@/queries/auth.queries'
import { MIN_PASSWORD_LENGTH, resetPasswordSchema } from '@/schemas/auth.schemas'

/**
 * The password-reset page. Top level, not under `_auth`, whose guard would
 * bounce a signed-in user who opens the link before the token is used. The
 * API mails `${WEB_URL}/reset-password?token=` (express verification.service.ts),
 * so the path is fixed, and this page renders `AuthLayout` itself. `.catch`
 * treats a non-string `?token=` as none, since the router JSON-parses search
 * values.
 */
export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Reset password') }] }),
  component: ResetPasswordPage,
  pendingComponent: AuthPagePending,
})

/** The new-password form for a mailed token; without a token it points to the forgot-password page. */
function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const resetPassword = useResetPassword()
  const serverErrors = useServerErrors()

  const form = useForm({
    /** The token rides in the form values, unrendered, so the schema validates it. */
    defaultValues: { token: token ?? '', password: '', confirmPassword: '' },
    validators: { onSubmit: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await resetPassword.mutateAsync(resetPasswordSchema.parse(value))
        toast.success('Your password has been reset. Sign in with it.')
        await navigate({ to: ROUTES.login })
      } catch (submitError) {
        serverErrors.capture(submitError)
      }
    },
  })

  if (!token) {
    return (
      <AuthLayout>
        <AuthCard
          title="This link is incomplete"
          description="The reset link is missing its token. Request a new one and use the most recent email."
        >
          <Link
            to={ROUTES.forgotPassword}
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          >
            Request a new link
          </Link>
        </AuthCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthCard
        title="Choose a new password"
        description={`It must be at least ${MIN_PASSWORD_LENGTH} characters long.`}
      >
        <Form form={form} serverErrors={serverErrors} className="space-y-0">
          <FieldGroup className="gap-6">
            <FormField form={form} name="password">
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

            <BusyButton
              busy={resetPassword.isPending}
              busyLabel="Saving…"
              type="submit"
              className="w-full"
            >
              Reset password
            </BusyButton>
          </FieldGroup>
        </Form>

        <FieldDescription className="text-center">
          <Link to={ROUTES.login}>Back to sign in</Link>
        </FieldDescription>
      </AuthCard>
    </AuthLayout>
  )
}
