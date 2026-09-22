import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
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
import { useForgotPassword } from '@/queries/auth.queries'
import { forgotPasswordSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/forgot-password')({
  component: ForgotPasswordPage,
})

/**
 * One message, whatever happened.
 *
 * The backend answers a known and an unknown address identically (Ruling G),
 * so showing a failure here — or a different message on success — would hand
 * an attacker the account-enumeration oracle the backend refuses to be.
 */
const SENT_MESSAGE = 'If that address has an account, a reset email has been sent.'

function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const forgotPassword = useForgotPassword()

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      try {
        await forgotPassword.mutateAsync(value)
      } catch {
        // Swallowed on purpose — see SENT_MESSAGE.
      }
      setSubmitted(true)
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>We will email you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        {submitted ? (
          <p role="status" className="text-sm">
            {SENT_MESSAGE}
          </p>
        ) : (
          <Form form={form}>
            <FormField form={form} name="email">
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

            <Button type="submit" className="w-full" disabled={forgotPassword.isPending}>
              {forgotPassword.isPending ? 'Sending…' : 'Send reset link'}
            </Button>
          </Form>
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
