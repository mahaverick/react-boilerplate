import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Pii } from '@/components/shared/pii'
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
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useRegister, useResendVerification } from '@/queries/auth.queries'
import { registerSchema, type RegisterInput } from '@/schemas/auth.schemas'

/**
 * The registration page. `?email=` prefills the address, as an invitation's
 * "Create account" sends it; `.catch` ignores a non-string, since the router
 * JSON-parses search values and `?email=123` arrives as a number.
 */
export const Route = createFileRoute('/_auth/register')({
  validateSearch: z.object({ email: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Create an account') }] }),
  component: RegisterPage,
})

/**
 * The registration form, then a "check your email" card with a resend control
 * for the address just registered. The value is parsed before posting, so the
 * schema's trimming and lowercasing reach the wire; the API answers with no
 * user, so the card shows the submitted, normalised address.
 */
function RegisterPage() {
  const { email: invitedEmail } = Route.useSearch()
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const register = useRegister()
  const resend = useResendVerification()
  const serverErrors = useServerErrors()

  /** Annotated: the names are optional in the schema, and an inferred `string` would not match. */
  const defaultValues: RegisterInput = {
    email: invitedEmail ?? '',
    password: '',
    firstName: '',
    lastName: '',
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: registerSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        const input = registerSchema.parse(value)
        await register.mutateAsync(input)
        setRegisteredEmail(input.email)
      } catch (submitError) {
        serverErrors.capture(submitError)
      }
    },
  })

  if (registeredEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Check your email</h1>
          </CardTitle>
          <CardDescription>
            We sent a verification link to <Pii>{registeredEmail}</Pii>. Open it to finish setting
            up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            disabled={resend.isPending}
            onClick={() => {
              resend.mutate(
                { email: registeredEmail },
                {
                  // The same message either way, so it never reveals whether the address is pending.
                  onSettled: () =>
                    toast.success('If that address needs verifying, a new email is on its way.'),
                }
              )
            }}
          >
            {resend.isPending ? 'Sending…' : 'Resend verification email'}
          </Button>
          <div className="mt-4 text-sm">
            <Link to={ROUTES.login} className="underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Create an account</h1>
        </CardTitle>
        <CardDescription>It takes less than a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} serverErrors={serverErrors}>
          <FormField form={form} name="firstName">
            {(field) => (
              <FormItem>
                <FormLabel>First name (optional)</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="given-name"
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

          <FormField form={form} name="lastName">
            {(field) => (
              <FormItem>
                <FormLabel>Last name (optional)</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="family-name"
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

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

          <FormField form={form} name="password">
            {(field) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
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

          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </Form>

        <div className="mt-4 text-sm">
          <Link to={ROUTES.login} className="underline underline-offset-4">
            Already have an account? Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
