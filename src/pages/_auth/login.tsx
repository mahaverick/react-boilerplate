import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { GOOGLE_OAUTH_PATH, ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useLogin } from '@/queries/auth.queries'
import { loginSchema } from '@/schemas/auth.schemas'

export const Route = createFileRoute('/_auth/login')({
  // A schema, not a hand-written function: it makes both keys OPTIONAL on the
  // input side, which is what keeps `_app`'s `redirect({ to: ROUTES.login,
  // search: { redirect } })` and `index`'s bare `redirect({ to: ROUTES.login })`
  // both type-checking against this route.
  validateSearch: z.object({
    error: z.string().optional(),
    redirect: z.string().optional(),
  }),
  component: LoginPage,
})

const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed: 'Google sign-in failed. Please try again.',
}

/**
 * Where to go after a successful sign-in.
 *
 * `?redirect=` is written by `_app`'s guard, but it arrives from the URL bar
 * and is therefore attacker-controlled: an absolute URL there would make this
 * page an open redirect. Only a same-origin ABSOLUTE PATH is accepted — one
 * leading slash, and the next character must not be another slash or a
 * backslash (browsers normalise `/\evil.com` to `//evil.com`, which is
 * protocol-relative and leaves the site).
 */
export function safeRedirect(value: string | undefined): string | null {
  if (!value) return null
  return /^\/(?![/\\])/.test(value) ? value : null
}

function LoginPage() {
  const { error, redirect } = Route.useSearch()
  const navigate = useNavigate()
  const login = useLogin()
  const serverErrors = useServerErrors()

  // The backend redirects here with ?error=<code> when OAuth fails.
  //
  // The ref is not belt-and-braces: `main.tsx` mounts the app in StrictMode,
  // which runs every effect twice in dev, and sonner does not dedupe — the
  // same failure would be announced twice. One toast per distinct code.
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
        await login.mutateAsync(value)
        const target = safeRedirect(redirect)
        await (target ? navigate({ href: target }) : navigate({ to: ROUTES.dashboard }))
      } catch (submitError) {
        serverErrors.capture(submitError)
        toast.error(messageFrom(submitError))
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
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

        {/* A plain anchor, not an axios call: this is a top-level navigation
            to a same-origin API route. Base UI's Button composes through
            `render`, where Radix used `asChild`. */}
        <Button variant="outline" className="mt-3 w-full" render={<a href={GOOGLE_OAUTH_PATH} />}>
          Continue with Google
        </Button>

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
