import '@/lib/zod-jitless'
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { z } from 'zod'
import {
  SigningInStatus,
  SwitchAccountPanel,
  VerifyFailedPanel,
} from '@/components/features/auth/link-panels'
import {
  ConfirmLinkDead,
  ConfirmLinkIncomplete,
  InvitationCard,
} from '@/components/features/invitations/invitation-parts'
import { landJoined } from '@/components/features/invitations/land-joined'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { buttonVariants } from '@/components/ui/button'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { statusFrom } from '@/lib/api-error'
import { retryableFailureMessage } from '@/lib/retry'
import { cn } from '@/lib/utils'
import { useLogout } from '@/queries/auth.queries'
import { useConfirmInvitation } from '@/queries/invitation.queries'
import { invitationTokenSchema } from '@/schemas/invitation.schemas'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where the confirmation link mailed to an existing account or a staff
 * invitee opens: `/invitations/confirm?token=…&email=…`. Top level, under
 * neither `_auth` nor `_app`: the link is opened signed out and signed in
 * alike, and each guard would bounce one of them. The API mails this fixed
 * path. `.catch` treats a non-string value as none, since the router
 * JSON-parses search values.
 */
export const Route = createFileRoute('/invitations/confirm')({
  validateSearch: z.object({
    token: z.string().optional().catch(undefined),
    email: z.string().optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Join your team') }] }),
  component: ConfirmInvitationPage,
  pendingComponent: AuthPagePending,
})

/**
 * The dead link, with a way on that fits whoever was signed in when the page
 * opened: the dashboard for someone signed in, a sign-in form otherwise.
 */
function DeadLink({ email, signedIn }: { email: string; signedIn: boolean }) {
  const navigate = useNavigate()
  return (
    <ConfirmLinkDead
      email={email}
      signedInAction={
        signedIn ? (
          <Link to={ROUTES.dashboard} replace className={cn(buttonVariants(), 'w-full')}>
            Go to the dashboard
          </Link>
        ) : null
      }
      onSignedIn={() => void navigate({ to: ROUTES.dashboard, replace: true })}
    />
  )
}

/**
 * Confirms a well-formed link once per page load and lands the person in the
 * tenant they joined.
 *
 * Who was signed in is read once, at mount: the confirm's own sign-in changes
 * the store before the page navigates, and the signed-in rows must not take
 * over then. Signed in as the link's address (in any case), or signed out, it
 * posts from a ref-guarded effect, so StrictMode's second run never spends the
 * link twice; the server replaces any session. Signed in as anyone else, it
 * asks first and spends nothing; Continue signs out and reloads this URL
 * signed out. Try again posts again on purpose.
 *
 * The frame names the link's address only while confirming; the toast names
 * the server's `user.email`. A 404 is the dead link, whatever its cause, and
 * the token leaves the URL; anything else leaves the link usable, so it gets
 * Try again.
 */
function ConfirmForToken({ token, email }: { token: string; email: string }) {
  const confirm = useConfirmInvitation()
  const navigate = useNavigate()
  const href = useLocation({ select: (location) => location.href })
  const [startedAs] = useState(() => useAuthStore.getState().user)
  const [returnTo] = useState(href)
  const logout = useLogout({ returnTo })
  /** The last confirm's failure, kept while Try again runs so the panel and its focus stay. */
  const [failure, setFailure] = useState<{ error: unknown } | null>(null)
  const [dead, setDead] = useState(false)
  const started = useRef(false)

  // Case-insensitive: neither side is trusted to stay lowercased. A mismatch never reaches the server.
  const someoneElse = startedAs !== null && startedAs.email.toLowerCase() !== email.toLowerCase()

  /** Posts the link; the outcome alone decides what the page shows next. */
  const post = () => {
    confirm.mutate(
      { token, email },
      {
        onSuccess: ({ tenant, user }) => {
          setFailure(null)
          landJoined(tenant, user.email, false, ({ slug }) => {
            void navigate({ to: '/tenants/$slug', params: { slug }, replace: true })
          })
        },
        onError: (error) => {
          if (statusFrom(error) !== 404) {
            setFailure({ error })
            return
          }
          setDead(true)
          // The refused token is a credential while it lives; it stays out of the URL from here on.
          void navigate({ to: ROUTES.invitationConfirm, search: { email }, replace: true })
        },
      }
    )
  }

  const start = useEffectEvent(() => {
    if (!someoneElse) post()
  })

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [])

  if (startedAs && someoneElse) {
    return (
      <InvitationCard title="Join your team">
        <SwitchAccountPanel
          kind="invitation"
          currentEmail={startedAs.email}
          targetEmail={email}
          continuing={logout.isPending}
          onContinue={() => logout.mutate()}
          onStay={() => void navigate({ to: ROUTES.dashboard, replace: true })}
        />
      </InvitationCard>
    )
  }

  if (dead) return <DeadLink email={email} signedIn={startedAs !== null} />

  if (failure) {
    return (
      <InvitationCard title="We couldn’t add you to your team">
        <VerifyFailedPanel
          message={retryableFailureMessage(failure.error, 'attempts')}
          retrying={confirm.isPending}
          onRetry={post}
        />
      </InvitationCard>
    )
  }

  return (
    <InvitationCard title="Joining your team">
      <SigningInStatus label="Joining your team…" email={email} />
    </InvitationCard>
  )
}

/**
 * Chooses the state for the link as it opened: incomplete, malformed, or a
 * link to confirm. Fixed at mount, so dropping the token after the outcome
 * never turns the page into the incomplete link.
 */
function ConfirmInvitationPage() {
  const search = Route.useSearch()
  // A bare or blank `?email=` names no address, so the link is incomplete.
  const [link] = useState(() => ({ token: search.token, email: search.email?.trim() || undefined }))
  const [signedIn] = useState(() => useAuthStore.getState().isAuthenticated)

  if (!link.token || !link.email) return <ConfirmLinkIncomplete />
  if (!invitationTokenSchema.safeParse(link.token).success) {
    return <DeadLink email={link.email} signedIn={signedIn} />
  }
  return <ConfirmForToken token={link.token} email={link.email} />
}
