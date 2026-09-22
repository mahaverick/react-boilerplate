import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
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
import { useResetPassword } from '@/queries/auth.queries'
import { resetPasswordSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const resetPassword = useResetPassword()

  const form = useForm({
    // The token rides in the form values so the schema validates it in one
    // place; the field itself is never rendered.
    defaultValues: { token: token ?? '', password: '', confirmPassword: '' },
    validators: { onSubmit: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      try {
        await resetPassword.mutateAsync(value)
        toast.success('Your password has been reset. Sign in with it.')
        await navigate({ to: ROUTES.login })
      } catch (submitError) {
        toast.error(messageFrom(submitError))
      }
    },
  })

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This link is incomplete</CardTitle>
          <CardDescription>
            The reset link is missing its token. Request a new one and use the most recent email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" render={<Link to={ROUTES.forgotPassword} />}>
            Request a new link
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>It must be at least 8 characters long.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form}>
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
  )
}
