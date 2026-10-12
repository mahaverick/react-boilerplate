import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
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
import { codeFrom, messageFrom } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { useResendVerification, useVerifyEmail } from '@/queries/auth.queries'
import { resendVerificationSchema, verifyEmailSchema } from '@/schemas/auth.schemas'
import { EMAIL_ALREADY_VERIFIED } from '@/types/api.types'

/**
 * The email-verification page. Top level, not under `_auth`, whose guard would
 * bounce a signed-in user who opens the link before the token is used. The
 * API mails `${WEB_URL}/verify-email?token=` (express verification.service.ts),
 * so the path is fixed, and this page renders `AuthLayout` itself. `.catch`
 * treats a non-string `?token=` as none, since the router JSON-parses search
 * values.
 */
export const Route = createFileRoute('/verify-email')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Verify email') }] }),
  component: VerifyEmailPage,
})

/** Confirms the emailed token with the account password, and offers a fresh link once a try fails. */
function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const verifyEmail = useVerifyEmail()
  const resend = useResendVerification()
  const [failed, setFailed] = useState(false)
  /** The server's message once the link proved already used, else `null`. */
  const [alreadyVerified, setAlreadyVerified] = useState<string | null>(null)
  const serverErrors = useServerErrors()

  const form = useForm({
    defaultValues: { token: token ?? '', password: '' },
    validators: { onSubmit: verifyEmailSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await verifyEmail.mutateAsync(verifyEmailSchema.parse(value))
        setFailed(false)
        setAlreadyVerified(null)
        toast.success('Your email is verified. Sign in to continue.')
        await navigate({ to: ROUTES.login })
      } catch (submitError) {
        if (codeFrom(submitError) === EMAIL_ALREADY_VERIFIED) {
          // Not a failure to retry: the account is verified, so only sign-in is left.
          setFailed(false)
          setAlreadyVerified(messageFrom(submitError))
          return
        }
        setAlreadyVerified(null)
        setFailed(true)
        serverErrors.capture(submitError)
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
        // The same message either way, so it never reveals whether the address needs verifying.
      }
      toast.success('If that address needs verifying, a new email is on its way.')
    },
  })

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Verify your email</h1>
          </CardTitle>
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

          {alreadyVerified !== null && (
            <div className="mt-6 border-t pt-4">
              <p role="status" className="text-sm">
                {alreadyVerified}
              </p>
              <Link to={ROUTES.login} className={cn(buttonVariants(), 'mt-3 w-full')}>
                Sign in
              </Link>
            </div>
          )}

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
