import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'
import { useResetPassword } from '@/queries/auth.queries'
import { resetPasswordSchema } from '@/schemas/auth.schemas'

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
})

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
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>This link is incomplete</h1>
            </CardTitle>
            <CardDescription>
              The reset link is missing its token. Request a new one and use the most recent email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to={ROUTES.forgotPassword}
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            >
              Request a new link
            </Link>
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Choose a new password</h1>
          </CardTitle>
          <CardDescription>It must be at least 8 characters long.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form form={form} serverErrors={serverErrors}>
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

            <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
              {resetPassword.isPending ? 'Saving…' : 'Reset password'}
            </Button>
          </Form>

          <div className="mt-4 text-sm">
            <Link to={ROUTES.login} className="underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
