import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { Button } from '@/components/ui/button'
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
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useResendVerification, useVerifyEmail } from '@/queries/auth.queries'
import { resendVerificationSchema, verifyEmailSchema } from '@/schemas/auth.schemas'

/**
 * Top level on purpose, NOT under `_auth`.
 *
 * `_auth`'s guard sends an authenticated visitor to /dashboard, which would
 * bounce a signed-in user who clicks the link in their inbox before the token
 * was ever consumed. The URL must not change either: the backend builds
 * `${WEB_URL}/verify-email?token=` in
 * express-boilerplate/src/utilities/verification-link.utilities.ts, with no
 * `/auth/` prefix, and links already sent point at that path. A top-level file
 * route keeps the path identical while sitting outside the guard, so this page
 * renders `AuthLayout` itself — `_auth`'s layout component no longer wraps it.
 */
export const Route = createFileRoute('/verify-email')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const verifyEmail = useVerifyEmail()
  const resend = useResendVerification()
  const [failed, setFailed] = useState(false)
  const serverErrors = useServerErrors()

  const form = useForm({
    // The account password is required by the backend here — it is not
    // optional, so the form collects it rather than sending the token alone.
    defaultValues: { token: token ?? '', password: '' },
    validators: { onSubmit: verifyEmailSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // Parsed, not posted raw: TanStack hands `value` straight from form
        // state, so the schema's `.trim()`/`.toLowerCase()` would never reach
        // the wire and "  ADA@B.COM  " would go over verbatim. Parsing here is
        // what makes the schema the wire contract it looks like.
        await verifyEmail.mutateAsync(verifyEmailSchema.parse(value))
        setFailed(false)
        toast.success('Your email is verified. Sign in to continue.')
        await navigate({ to: ROUTES.login })
      } catch (submitError) {
        setFailed(true)
        serverErrors.capture(submitError)
        toast.error(messageFrom(submitError))
      }
    },
  })

  const resendForm = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: resendVerificationSchema },
    onSubmit: async ({ value }) => {
      try {
        await resend.mutateAsync(resendVerificationSchema.parse(value))
      } catch {
        // Same message either way: whether an address needs verifying is not
        // ours to leak.
      }
      toast.success('If that address needs verifying, a new email is on its way.')
    },
  })

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Verify your email</CardTitle>
          <CardDescription>
            Confirm the link from your inbox with the password you chose when registering.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form form={form} serverErrors={serverErrors}>
            <FormField form={form} name="token">
              {(field) => (
                <FormItem>
                  <FormLabel>Verification token</FormLabel>
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

            <FormField form={form} name="password">
              {(field) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
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

            <FormError />

            <Button type="submit" className="w-full" disabled={verifyEmail.isPending}>
              {verifyEmail.isPending ? 'Verifying…' : 'Verify email'}
            </Button>
          </Form>

          {failed && (
            <div className="mt-6 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Links expire. Enter your address and we will send a fresh one.
              </p>
              <Form form={resendForm} className="mt-3">
                <FormField form={resendForm} name="email">
                  {(field) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          value={fieldValue(field.state.value)}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                </FormField>

                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={resend.isPending}
                >
                  {resend.isPending ? 'Sending…' : 'Resend verification email'}
                </Button>
              </Form>
            </div>
          )}

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
