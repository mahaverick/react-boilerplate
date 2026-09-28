import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { GOOGLE_OAUTH_PATH, ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { cn } from '@/lib/utils'
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
})

/** Keyed by the `?error=` codes the API's Google callback redirects with. */
const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed: 'Google sign-in failed. Please try again.',
  email_not_verified:
    "Google hasn't verified this email address. Verify it with Google, or sign up with email and password.",
  google_email_missing: "Your Google account didn't share an email address.",
  processing_failed: 'Something went wrong signing in with Google. Try again.',
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
 * The sign-in form, plus the Google sign-in link.
 *
 * An OAuth failure arrives as `?error=<code>` and is toasted once per distinct
 * code: StrictMode runs effects twice in dev and sonner does not dedupe. The
 * value is parsed before posting, so the schema's trimming and lowercasing
 * reach the wire.
 *
 * "Continue with Google" is a plain anchor with `buttonVariants` classes, a
 * top-level navigation to a same-origin API route. It stays a link (the
 * keyboard test pins `role="link"`): Base UI's Button with `render={<a/>}`
 * warns, and its `nativeButton={false}` fix would add `role="button"`.
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
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} serverErrors={serverErrors}>
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

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Form>

        <a
          href={GOOGLE_OAUTH_PATH}
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 w-full')}
        >
          Continue with Google
        </a>

        <div className="mt-4 flex justify-between text-sm">
          <Link to={ROUTES.forgotPassword} className="underline underline-offset-4">
            Forgot password?
          </Link>
          <Link to={ROUTES.register} className="underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
