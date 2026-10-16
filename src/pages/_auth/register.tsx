import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { TermsNote } from '@/components/features/auth/terms-note'
import { AuthCard } from '@/components/layouts/auth-card'
import { BusyButton } from '@/components/shared/busy-button'
import { AuthPending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormDescription,
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
import { useRegister, useResendVerification } from '@/queries/auth.queries'
import { MIN_PASSWORD_LENGTH, registerSchema, type RegisterInput } from '@/schemas/auth.schemas'

/**
 * The registration page. `?email=` prefills the address, as an invitation's
 * "Create account" sends it; `.catch` ignores a non-string, since the router
 * JSON-parses search values and `?email=123` arrives as a number.
 */
export const Route = createFileRoute('/_auth/register')({
  validateSearch: z.object({ email: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Create an account') }] }),
  component: RegisterPage,
  pendingComponent: AuthPending,
})

/**
 * The registration form's values: the API's `registerSchema` plus a password
 * confirmation the API never sees. A mismatch is reported on the
 * confirmation field. The submit parses with `registerSchema`, which drops
 * `confirmPassword` from the payload.
 */
const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, 'Confirm your password.') })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

/**
 * The registration form, on shadcn's signup-04 layout, then a "check your
 * email" card with a resend control for the address just registered. The
 * value is parsed before posting, so the schema's trimming and lowercasing
 * reach the wire; the API answers with no user, so the card shows the
 * submitted, normalised address.
 */
function RegisterPage() {
  const { email: invitedEmail } = Route.useSearch()
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const register = useRegister()
  const resend = useResendVerification()
  const serverErrors = useServerErrors()

  /** Annotated: the names are optional in the schema, and an inferred `string` would not match. */
  const defaultValues: RegisterInput & { confirmPassword: string } = {
    email: invitedEmail ?? '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: registerFormSchema },
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
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a verification link to <Pii>{registeredEmail}</Pii>. Open it to finish setting
            up your account.
          </>
        }
      >
        <BusyButton
          busy={resend.isPending}
          busyLabel="Sending…"
          variant="outline"
          className="w-full"
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
          Resend verification email
        </BusyButton>
        <FieldDescription className="text-center">
          <Link to={ROUTES.login}>Back to sign in</Link>
        </FieldDescription>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create an account"
      description="It takes less than a minute."
      footer={<TermsNote />}
    >
      <Form form={form} serverErrors={serverErrors} className="space-y-0">
        <FieldGroup className="gap-6">
          <div className="grid items-start gap-4 sm:grid-cols-2">
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
          </div>

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

          <div className="grid items-start gap-4 sm:grid-cols-2">
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
            <FormField form={form} name="confirmPassword">
              {(field) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
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
          </div>
          <FormDescription className="-mt-3">
            Must be at least {MIN_PASSWORD_LENGTH} characters long.
          </FormDescription>

          <FormError />

          <BusyButton
            busy={register.isPending}
            busyLabel="Creating account…"
            type="submit"
            className="w-full"
          >
            Create account
          </BusyButton>

          <SocialSignIn />

          <FieldDescription className="text-center">
            Already have an account? <Link to={ROUTES.login}>Sign in</Link>
          </FieldDescription>
        </FieldGroup>
      </Form>
    </AuthCard>
  )
}
