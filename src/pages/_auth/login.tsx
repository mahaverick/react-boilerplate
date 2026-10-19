import '@/lib/zod-jitless'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { CHECK_INBOX_TITLE, SignInLinkForm } from '@/components/features/auth/sign-in-link-form'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { TermsNote } from '@/components/features/auth/terms-note'
import { AuthCard } from '@/components/layouts/auth-card'
import { Note } from '@/components/shared/note'
import { AuthPending } from '@/components/shared/pending-templates'
import { FieldGroup } from '@/components/ui/field'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { safeLanding } from '@/lib/landing'
import { toast } from '@/lib/toast'

/**
 * The sign-in page. `validateSearch` is a schema so every key is optional on
 * the input side, which lets both `_app`'s `redirect({ search: { redirect } })`
 * and `index`'s bare `redirect()` type-check against this route. `notice` is
 * set by the retired password paths; any other value is dropped.
 */
export const Route = createFileRoute('/_auth/login')({
  validateSearch: z.object({
    error: z.string().optional(),
    redirect: z.string().optional(),
    // An enum, not a literal: the entry chunk already carries Zod's enum class.
    notice: z.enum(['sign-in-link']).optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Sign in') }] }),
  component: LoginPage,
  pendingComponent: AuthPending,
})

/** Keyed by the `?error=` codes the API's Google callback redirects with. */
const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed: 'Google sign-in failed. Try again, or sign in with an email link.',
  email_not_verified:
    'Google hasn’t verified this email address. Verify it with Google, or sign in with an email link.',
  google_email_missing:
    'Your Google account didn’t share an email address. Sign in with an email link instead.',
  processing_failed: 'Google sign-in didn’t finish. Try again, or sign in with an email link.',
  // The API refuses a non-staff sign-in while maintenance mode is full.
  MAINTENANCE_MODE: 'Sign-in is paused for maintenance. Try again when maintenance ends.',
  // In read-only maintenance the API signs in existing accounts only; this Google address has none.
  READ_ONLY_MODE:
    'We can’t create new accounts during maintenance. Sign in to an account you already have, or try again when maintenance ends.',
}

/**
 * Sign-in by emailed link, with Google as the alternative. The card titles
 * itself from `sentTo`, which this page owns, while `SignInLinkForm` keeps its
 * place in the tree across the switch to "Check your inbox", so its resend
 * clock survives. Another tab that uses the link signs this one in, and the
 * page then lands on the redirect or the dashboard.
 *
 * An OAuth failure arrives as `?error=<code>` and is toasted once per distinct
 * code: StrictMode runs effects twice in dev, and a toast raised without an
 * `id` is not deduped.
 */
function LoginPage() {
  const { error, redirect, notice } = Route.useSearch()
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)
  // A token page is dropped: carried through, its token would be mailed again inside the new link.
  const landing = safeLanding(redirect) ?? undefined

  const toastedError = useRef<string | null>(null)
  useEffect(() => {
    if (!error || toastedError.current === error) return
    toastedError.current = error
    toast.error(OAUTH_ERRORS[error] ?? 'Sign-in failed. Try again, or sign in with an email link.')
  }, [error])

  /** Leaves sign-in for the landing path, replacing this page in history. */
  const onSignedIn = () => {
    void (landing
      ? navigate({ href: landing, replace: true })
      : navigate({ to: ROUTES.dashboard, replace: true }))
  }

  return (
    <AuthCard
      title={sentTo ? CHECK_INBOX_TITLE : 'Sign in'}
      description={sentTo ? undefined : 'Enter your email and we’ll send you a link to sign in.'}
      footer={<TermsNote />}
    >
      {notice && sentTo === null && (
        <Note tone="passive">Sign in with an email link or Google. Passwords no longer work.</Note>
      )}
      <FieldGroup className="gap-6">
        <SignInLinkForm
          sentTo={sentTo}
          onSentToChange={setSentTo}
          redirect={landing}
          onSignedIn={onSignedIn}
        />
        {sentTo === null && <SocialSignIn redirect={landing} />}
      </FieldGroup>
    </AuthCard>
  )
}
