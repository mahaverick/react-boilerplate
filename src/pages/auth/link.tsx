import '@/lib/zod-jitless'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import {
  SigningInStatus,
  SwitchAccountPanel,
  VerifyFailedPanel,
} from '@/components/features/auth/link-panels'
import {
  CHECK_INBOX_TITLE,
  LINK_DEAD_TITLE,
  SignInLinkForm,
} from '@/components/features/auth/sign-in-link-form'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { broadcastAuthMessage } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import { safeLanding } from '@/lib/landing'
import { retryableFailureMessage } from '@/lib/retry'
import { useLogout, useVerifySignInLink } from '@/queries/auth.queries'
import { tenantsQueryOptions } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where a mailed sign-in link opens: `/auth/link?token=…&email=…[&redirect=…]`.
 * Top level, under neither `_auth` nor `_app`: the link is opened signed out
 * and signed in alike, and each guard would bounce one of them. The API mails
 * this fixed path. It renders `AuthLayout` itself, like the accept page.
 * `.catch` treats a non-string value as none, since the router JSON-parses
 * search values.
 */
export const Route = createFileRoute('/auth/link')({
  validateSearch: z.object({
    token: z.string().optional().catch(undefined),
    email: z.string().optional().catch(undefined),
    redirect: z.string().optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Signing in') }] }),
  component: SignInLinkPage,
  pendingComponent: AuthPagePending,
})

/** What a successful verify answers, as far as the landing reads it. */
interface VerifiedLink {
  isNewUser: boolean
  redirect: string | null
}

/** Every state's frame: one `<main>` (AuthLayout) and one `<h1>`. */
function LinkCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <AuthLayout>
      <AuthCard title={title} description={description}>
        {children}
      </AuthCard>
    </AuthLayout>
  )
}

/**
 * A link that cannot sign anyone in: it carried no token, or the server
 * refused it. The page says nothing about which, and offers a new link to the
 * address the old one named, landing where the old one would have. The form keeps its place in the tree when it
 * switches to "Check your inbox", so its resend clock survives.
 */
function DeadLink({
  email,
  redirect,
}: {
  email: string | undefined
  redirect: string | undefined
}) {
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const landing = safeLanding(redirect) ?? undefined
  return (
    <LinkCard
      title={sentTo ? CHECK_INBOX_TITLE : LINK_DEAD_TITLE}
      description={sentTo ? undefined : 'The link works once and expires in 15 minutes.'}
    >
      <SignInLinkForm
        sentTo={sentTo}
        onSentToChange={setSentTo}
        redirect={landing}
        defaultEmail={email}
        submitLabel="Email me a new link"
        onSignedIn={() =>
          void (landing
            ? navigate({ href: landing, replace: true })
            : navigate({ to: ROUTES.dashboard, replace: true }))
        }
      />
    </LinkCard>
  )
}

/**
 * Verifies the link once per page load and lands the person signed in.
 *
 * Who was signed in is read once, at mount: the verify's own sign-in changes
 * the store before the page navigates, and the signed-in rows must not take
 * over then. Signed in as the link's address, the page goes straight on and
 * spends nothing. Signed in as anyone else, it asks first; Continue signs out
 * and reloads this URL signed out, so the token is never posted with another
 * person's session. Signed out, it posts the token from a ref-guarded effect,
 * so StrictMode's second run never spends the link twice; Try again posts
 * again on purpose. The link's `email` goes with the token: the server refuses
 * an address that is not the token's own, so the verifying frame can name it,
 * and once signed in the frame names the address the server confirmed.
 *
 * A 400 is the dead link, whatever its cause. Anything else (a rate limit,
 * maintenance, a network or server error) leaves the link usable, so it gets
 * Try again. Every landing passes through `safeRedirect` and replaces this
 * page in history, so Back never returns to the token.
 */
function SignInLinkPage() {
  const { token, email: rawEmail, redirect } = Route.useSearch()
  // A bare or blank `?email=` names no address: no switch target, no "This link is for", none posted.
  const email = rawEmail?.trim() || undefined
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const verify = useVerifySignInLink()
  const logout = useLogout({ returnTo: window.location.href })
  const [startedAs] = useState(() => useAuthStore.getState().user)
  /** The last verify's failure, kept while Try again runs so the panel and its focus stay. */
  const [failure, setFailure] = useState<{ error: unknown } | null>(null)
  const started = useRef(false)

  const samePerson =
    startedAs !== null &&
    email !== undefined &&
    email.toLowerCase() === startedAs.email.toLowerCase()

  /** Tells waiting tabs, then lands: a new account on /welcome, else a safe redirect, else by tenant count. */
  const land = (link: VerifiedLink) => {
    broadcastAuthMessage('signed_in')
    if (link.isNewUser) {
      void navigate({ to: ROUTES.welcome, replace: true })
      return
    }
    const target = safeLanding(link.redirect) ?? safeLanding(redirect)
    if (target) {
      void navigate({ href: target, replace: true })
      return
    }
    void queryClient.fetchQuery(tenantsQueryOptions()).then(
      (tenants) =>
        navigate({ to: tenants.length === 0 ? ROUTES.welcome : ROUTES.dashboard, replace: true }),
      () => navigate({ to: ROUTES.dashboard, replace: true })
    )
  }

  /** Posts the token; the outcome alone decides what the page shows next. */
  const post = (linkToken: string) => {
    verify.mutate(
      { token: linkToken, email },
      {
        onSuccess: (link) => {
          setFailure(null)
          land(link)
        },
        onError: (error) => setFailure({ error }),
      }
    )
  }

  const start = useEffectEvent(() => {
    if (startedAs) {
      if (!token) void navigate({ to: ROUTES.dashboard, replace: true })
      else if (samePerson) {
        const target = safeLanding(redirect)
        void (target
          ? navigate({ href: target, replace: true })
          : navigate({ to: ROUTES.dashboard, replace: true }))
      }
      return
    }
    if (token) post(token)
  })

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [])

  if (!token) {
    return startedAs ? <Verifying /> : <DeadLink email={email} redirect={redirect} />
  }

  if (startedAs) {
    if (samePerson) return <Verifying />
    return (
      <LinkCard title="Switch account?">
        <SwitchAccountPanel
          kind="link"
          currentEmail={startedAs.email}
          targetEmail={email ?? null}
          continuing={logout.isPending}
          onContinue={() => logout.mutate()}
          onStay={() => void navigate({ to: ROUTES.dashboard, replace: true })}
        />
      </LinkCard>
    )
  }

  if (failure) {
    if (statusFrom(failure.error) === 400) return <DeadLink email={email} redirect={redirect} />
    return (
      <LinkCard title="We couldn’t sign you in">
        <VerifyFailedPanel
          message={retryableFailureMessage(failure.error, 'sign-in attempts')}
          retrying={verify.isPending}
          onRetry={() => post(token)}
        />
      </LinkCard>
    )
  }

  return <Verifying email={verify.data?.user.email ?? email} />
}

/** The verifying frame, naming the account being signed in when the page knows it. */
function Verifying({ email }: { email?: string | undefined }) {
  return (
    <LinkCard title="Signing you in">
      <SigningInStatus label="Signing you in…" email={email} />
    </LinkCard>
  )
}
