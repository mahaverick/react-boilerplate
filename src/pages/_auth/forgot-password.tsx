import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthCard } from '@/components/layouts/auth-card'
import { BusyButton } from '@/components/shared/busy-button'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useForgotPassword } from '@/queries/auth.queries'
import { forgotPasswordSchema } from '@/schemas/auth.schemas'

/** The forgot-password route, inside the signed-out `_auth` layout. */
export const Route = createFileRoute('/_auth/forgot-password')({
  head: () => ({ meta: [{ title: pageTitle('Forgot password') }] }),
  component: ForgotPasswordPage,
})

/**
 * One message, whatever happened. The API answers a known and an unknown
 * address identically, so a failure message here, or a different success
 * message, would be an account-enumeration oracle. This form shows no server
 * errors for the same reason.
 */
const SENT_MESSAGE = 'If that address has an account, a reset email has been sent.'

/** The email form; whatever the outcome, it then shows `SENT_MESSAGE`. */
function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const forgotPassword = useForgotPassword()

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      try {
        await forgotPassword.mutateAsync(forgotPasswordSchema.parse(value))
      } catch {
        // Swallowed: any failure message would be an enumeration oracle (see SENT_MESSAGE).
      }
      setSubmitted(true)
    },
  })

  return (
    <AuthCard
      title="Forgot your password?"
      description="We will email you a link to set a new one."
    >
      {submitted ? (
        <p role="status" className="text-center text-sm">
          {SENT_MESSAGE}
        </p>
      ) : (
        <Form form={form} className="space-y-0">
          <FieldGroup className="gap-6">
            <FormField form={form} name="email">
              {(field) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={fieldValue(field.state.value)}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </FormField>

            <BusyButton
              busy={forgotPassword.isPending}
              busyLabel="Sending…"
              type="submit"
              className="w-full"
            >
              Send reset link
            </BusyButton>
          </FieldGroup>
        </Form>
      )}

      <FieldDescription className="text-center">
        <Link to={ROUTES.login}>Back to sign in</Link>
      </FieldDescription>
    </AuthCard>
  )
}
