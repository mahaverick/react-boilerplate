import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { useRegister, useResendVerification } from '@/queries/auth.queries'
import { registerSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/register')({
  component: RegisterPage,
})

function RegisterPage() {
  // Set once the account exists. The address is kept so the resend control
  // below can use it without asking for it a second time.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const register = useRegister()
  const resend = useResendVerification()

  const form = useForm({
    defaultValues: { email: '', password: '', firstName: '', lastName: '' },
    validators: { onSubmit: registerSchema },
    onSubmit: async ({ value }) => {
      try {
        const user = await register.mutateAsync(value)
        setRegisteredEmail(user.email)
      } catch (submitError) {
        toast.error(messageFrom(submitError))
      }
    },
  })

  if (registeredEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a verification link to {registeredEmail}. Open it to finish setting up your
            account.
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
                  // Deliberately the same message either way: whether an
                  // address has a pending verification is not ours to leak.
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
        <CardTitle>Create an account</CardTitle>
        <CardDescription>It takes less than a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form}>
          <FormField form={form} name="firstName">
            {(field) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
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
                <FormLabel>Last name</FormLabel>
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
