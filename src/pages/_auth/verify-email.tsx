import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { messageFrom } from '@/lib/api-error'
import { useResendVerification, useVerifyEmail } from '@/queries/auth.queries'
import { resendVerificationSchema, verifyEmailSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/verify-email')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const verifyEmail = useVerifyEmail()
  const resend = useResendVerification()
  const [failed, setFailed] = useState(false)

  const form = useForm({
    // The account password is required by the backend here — it is not
    // optional, so the form collects it rather than sending the token alone.
    defaultValues: { token: token ?? '', password: '' },
    validators: { onSubmit: verifyEmailSchema },
    onSubmit: async ({ value }) => {
      try {
        await verifyEmail.mutateAsync(value)
        setFailed(false)
        toast.success('Your email is verified. Sign in to continue.')
        await navigate({ to: ROUTES.login })
      } catch (submitError) {
        setFailed(true)
        toast.error(messageFrom(submitError))
      }
    },
  })

  const resendForm = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: resendVerificationSchema },
    onSubmit: async ({ value }) => {
      try {
        await resend.mutateAsync(value)
      } catch {
        // Same message either way: whether an address needs verifying is not
        // ours to leak.
      }
      toast.success('If that address needs verifying, a new email is on its way.')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Confirm the link from your inbox with the password you chose when registering.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form}>
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
  )
}
