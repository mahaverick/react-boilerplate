import '@/lib/zod-jitless'
import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { TermsNote } from '@/components/features/auth/terms-note'
import { AuthCard } from '@/components/layouts/auth-card'
import { BusyButton } from '@/components/shared/busy-button'
import { AuthPending } from '@/components/shared/pending-templates'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
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
import { toast } from '@/lib/toast'
import { useLogin } from '@/queries/auth.queries'
import { loginSchema } from '@/schemas/auth.schemas'

/**
 * The sign-in page. `validateSearch` is a schema so both keys are optional on
 * the input side, which lets both `_app`'s `redirect({ search: { redirect } })`
 * and `index`'s bare `redirect()` type-check against this route.
 */
export const Route = createFileRoute('/_auth/login')({
  validateSearch: z.object({
    error: z.string().optional(),
    redirect: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: pageTitle('Sign in') }] }),
  component: LoginPage,
  pendingComponent: AuthPending,
})

/** Keyed by the `?error=` codes the API's Google callback redirects with. */
const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed: 'Google sign-in failed. Please try again.',
  email_not_verified:
    "Google hasn't verified this email address. Verify it with Google, or sign up with email and password.",
  google_email_missing: "Your Google account didn't share an email address.",
  processing_failed: 'Something went wrong signing in with Google. Try again.',
  // The API refuses a non-staff sign-in while maintenance mode is full.
  MAINTENANCE_MODE: 'Sign-in is paused for maintenance. Please try again later.',
}

/**
 * Where to go after a successful sign-in, or `null` to use the dashboard.
 *
 * `?redirect=` is written by `_app`'s guard and `redirectToLogin`, but it
 * arrives from the URL bar and is attacker-controlled: an absolute URL there
 * would make this page an open redirect. So the value must start with `/`
 * (which keeps out a bare relative value and a `javascript:` scheme), and is
 * then resolved by the URL parser rather than matched by a pattern, since
 * both cases below pass a `^/(?![/\\])`-style test. `/\t/evil.example` loses
 * its control character and resolves off this origin, which the origin check
 * refuses. `/..//evil.example` resolves same-origin to the pathname
 * `//evil.example`, protocol-relative once assigned, which the re-check for a
 * leading `//` refuses. A value the parser cannot resolve is refused.
 *
 * The whole same-origin `pathname + search + hash` is returned, so a query
 * survives.
 */
export function safeRedirect(value: string | undefined): string | null {
  if (!value || !value.startsWith('/')) return null
  try {
    const resolved = new URL(value, window.location.origin)
    if (resolved.origin !== window.location.origin) return null
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
    // Same origin is not enough: "/..//evil.example" resolves to the pathname "//evil.example".
    return path.startsWith('/') && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}

/**
 * The sign-in form, on shadcn's login-04 layout, plus a button per configured
 * social provider (`SocialSignIn`).
 *
 * An OAuth failure arrives as `?error=<code>` and is toasted once per distinct
 * code: StrictMode runs effects twice in dev, and a toast raised without an
 * `id` is not deduped. The value is parsed before posting, so the schema's
 * trimming and lowercasing reach the wire.
 */
function LoginPage() {
  const { error, redirect } = Route.useSearch()
  const navigate = useNavigate()
  const login = useLogin()
  const serverErrors = useServerErrors()

  const toastedError = useRef<string | null>(null)
  useEffect(() => {
    if (!error || toastedError.current === error) return
    toastedError.current = error
    toast.error(OAUTH_ERRORS[error] ?? 'Sign-in failed. Please try again.')
  }, [error])

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await login.mutateAsync(loginSchema.parse(value))
        const target = safeRedirect(redirect)
        await (target ? navigate({ href: target }) : navigate({ to: ROUTES.dashboard }))
      } catch (submitError) {
        serverErrors.capture(submitError)
      }
    },
  })

  return (
    <AuthCard
      title="Sign in"
      description="Enter your email and password to continue."
      footer={<TermsNote />}
    >
      <Form form={form} serverErrors={serverErrors} className="space-y-0">
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

          <FormField form={form} name="password">
            {(field) => (
              <FormItem>
                <div className="flex items-center">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to={ROUTES.forgotPassword}
                    className="ml-auto text-sm underline underline-offset-4"
                  >
                    Forgot password?
                  </Link>
                </div>
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

          <BusyButton
            busy={login.isPending}
            busyLabel="Signing in…"
            type="submit"
            className="w-full"
          >
            Sign in
          </BusyButton>

          <SocialSignIn />

          <FieldDescription className="text-center">
            Don&apos;t have an account? <Link to={ROUTES.register}>Create an account</Link>
          </FieldDescription>
        </FieldGroup>
      </Form>
    </AuthCard>
  )
}
