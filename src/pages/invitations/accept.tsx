import '@/lib/zod-jitless'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import {
  SigningInStatus,
  SwitchAccountPanel,
  VerifyFailedPanel,
} from '@/components/features/auth/link-panels'
import {
  CHECK_INBOX_TITLE,
  RESEND_COOLDOWN_SECONDS,
  SignInLinkForm,
} from '@/components/features/auth/sign-in-link-form'
import {
  HomeLink,
  InvitationCard,
  InvitationInbox,
} from '@/components/features/invitations/invitation-parts'
import { landJoined, type JoinedTenant } from '@/components/features/invitations/land-joined'
import { LoadError } from '@/components/features/load-error'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { retryAfterSecondsFrom, statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { retryableFailureMessage } from '@/lib/retry'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ANALYTICS_URL_QUERY_ALLOWLIST } from '@/observability/telemetry/config'
import { sanitizeUrl } from '@/observability/telemetry/url-sanitizer'
import { useLogout } from '@/queries/auth.queries'
import {
  inviterName,
  isConfirmationSent,
  refreshJoinedTenant,
  useAcceptInvitation,
  useInvitationPreview,
  useVerifyInvitation,
} from '@/queries/invitation.queries'
import { invitationTokenSchema } from '@/schemas/invitation.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { InvitationPreview, InvitationVerifyResult, User } from '@/types/api.types'

/**
 * The invitation landing page. Top level, under neither `_auth` nor `_app`:
 * the link is opened signed out and signed in alike, and each guard would
 * bounce one of them. The API mails links to this fixed path. It renders
 * `AuthLayout` itself, like welcome.tsx. `.catch` treats a non-string
 * `?token=` as none, since the router JSON-parses search values.
 */
export const Route = createFileRoute('/invitations/accept')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Accept invitation') }] }),
  component: AcceptInvitationPage,
  pendingComponent: AuthPagePending,
})

const PREVIEW_ERROR =
  'We could not load this invitation. The request failed, which is not the same as the invitation being invalid.'

/** The title of every invitation that cannot join anyone, whatever the reason. */
const DEAD_TITLE = 'This invitation can’t be used'

/** Which call joins: `verify` signs a signed-out invitee in, `accept` joins the signed-in one. */
type JoinCall = 'verify' | 'accept'

/** The call the page made, and the invitation it showed while making it: null when the preview had already 404ed. */
interface Joining {
  call: JoinCall
  invitation: InvitationPreview | null
}

/** How a join ended without landing: the invitation is dead, or the request failed and may pass. */
type JoinFailure = { kind: 'dead' } | { kind: 'failed'; error: unknown }

/** The campaign keys express puts on a mailed link; a reload of this page carries them. */
const CAMPAIGN_KEYS = ANALYTICS_URL_QUERY_ALLOWLIST.filter((key) => key.startsWith('utm_'))

/**
 * Where this page lives, token included, for the round trips that leave it.
 * The link's campaign keys come along, each only with a value the analytics
 * sanitizer would keep, so the reload's page view is still attributed and
 * nothing else from the old URL travels.
 * @param token - The invitation token.
 * @param searchStr - The current raw query string, `?…` or empty.
 */
function acceptHref(token: string, searchStr = ''): string {
  const campaign = sanitizeUrl(`/${searchStr}`, CAMPAIGN_KEYS).split('?')[1]
  return `${ROUTES.invitationAccept}?token=${encodeURIComponent(token)}${campaign ? `&${campaign}` : ''}`
}

/** "{inviter} invited you to join {tenant} as {role}.", the inviter's name masked for analytics. */
function invitationSentence(invitation: InvitationPreview): ReactNode {
  return (
    <>
      <Pii>{inviterName(invitation.invitedBy)}</Pii> invited you to join {invitation.tenant.name} as{' '}
      {ROLE_LABELS[invitation.role]}.
    </>
  )
}

/**
 * An invitation that cannot join anyone: malformed, revoked, expired or
 * already used. It names the inviter only when a live preview gave one, and
 * never an address. Someone signed in when it appeared goes on to the
 * dashboard. Anyone else gets a sign-in form with no address and no redirect,
 * so this page never passes on anything it did not get from a preview. The
 * form keeps its place in the tree when it switches to "Check your inbox", so
 * its resend clock survives.
 */
function DeadInvitation({ inviter }: { inviter: InvitationPreview['invitedBy'] | undefined }) {
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)
  // Read once: a sign-in from another tab while the form waits on the inbox must not swap the form out.
  const [signedIn] = useState(() => useAuthStore.getState().isAuthenticated)
  const name = fullName(inviter)
  const ask = name ? (
    <>
      Ask <Pii>{name}</Pii> for a new invite.
    </>
  ) : (
    'Ask the team for a new invite.'
  )
  if (signedIn) {
    return (
      <InvitationCard title={DEAD_TITLE} description={ask}>
        <Link to={ROUTES.dashboard} replace className={cn(buttonVariants(), 'w-full')}>
          Go to the dashboard
        </Link>
      </InvitationCard>
    )
  }
  return (
    <InvitationCard
      title={sentTo ? CHECK_INBOX_TITLE : DEAD_TITLE}
      description={sentTo ? undefined : ask}
    >
      <div className="grid gap-3">
        {sentTo ? null : <p className="text-sm">Or sign in:</p>}
        <SignInLinkForm
          sentTo={sentTo}
          onSentToChange={setSentTo}
          onSignedIn={() => void navigate({ to: ROUTES.dashboard, replace: true })}
        />
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

/**
 * Signed in as an address the invitation is not for. Nothing is spent until
 * Continue, which signs out and reloads this page signed out, where it
 * verifies; Cancel keeps the session and opens the dashboard.
 */
function SwitchInvitation({
  token,
  invitation,
  currentEmail,
}: {
  token: string
  invitation: InvitationPreview
  currentEmail: string
}) {
  const navigate = useNavigate()
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const logout = useLogout({ returnTo: acceptHref(token, searchStr) })
  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <SwitchAccountPanel
        kind="invitation"
        currentEmail={currentEmail}
        targetEmail={invitation.email}
        continuing={logout.isPending}
        onContinue={() => logout.mutate()}
        onStay={() => void navigate({ to: ROUTES.dashboard, replace: true })}
      />
    </InvitationCard>
  )
}

/**
 * The frame while a join runs. With the preview it reads "Joining {workspace}
 * as {address}…" and names the inviter. The address is the preview's, the
 * server's record of who was invited, never a URL parameter, so a link planted
 * to sign a visitor into someone else's account names that account before it
 * lands. After a 404 preview it names nothing.
 */
function JoiningFrame({ invitation }: { invitation: InvitationPreview | null }) {
  if (!invitation) {
    return (
      <InvitationCard title="Checking your invitation">
        <SigningInStatus label="Checking your invitation…" />
      </InvitationCard>
    )
  }
  const name = invitation.tenant.name
  return (
    <InvitationCard title={`Joining ${name}`} description={invitationSentence(invitation)}>
      <SigningInStatus
        label={
          <>
            Joining {name} as <Pii>{invitation.email}</Pii>…
          </>
        }
      />
    </InvitationCard>
  )
}

/**
 * The call the page makes for a settled preview and whoever was signed in at
 * mount, or null when it makes none: still loading, a failed request, a dead
 * link signed out, or a different signed-in address.
 */
function joinCallFor(
  invitation: InvitationPreview | undefined,
  gone: boolean,
  startedAs: User | null
): JoinCall | null {
  if (invitation) {
    if (!startedAs) return 'verify'
    // Case-insensitive: neither side is trusted to stay lowercased. A mismatch never reaches the server.
    return startedAs.email.toLowerCase() === invitation.email.toLowerCase() ? 'accept' : null
  }
  return gone && startedAs ? 'accept' : null
}

/**
 * The page for a well-formed token. The preview is asked as a stranger, then
 * the page joins on load with no button: signed out, it verifies, which signs
 * a new address in, or answers `202` for an existing account or a staff
 * invitation, which shows "Check your inbox" and sets no session; signed in as
 * the invitee, it accepts. A used link joins
 * nobody signed out; signed in, it still accepts, because the API answers
 * `alreadyMember` only to the invitee who used it and 404 to anyone else.
 * Signed in as another address, it asks before switching.
 *
 * Who was signed in is read once, at mount: the verify's own sign-in changes
 * the store before the page navigates, and the signed-in rows must not take
 * over then and accept again. The call fires from a ref-guarded effect, so
 * StrictMode's second run never spends the link twice; Try again posts again
 * on purpose. Once a call has started, only its outcome drives the page.
 */
function InvitationForToken({ token }: { token: string }) {
  const preview = useInvitationPreview(token)
  const verify = useVerifyInvitation()
  const accept = useAcceptInvitation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [startedAs] = useState(() => useAuthStore.getState().user)
  const [joining, setJoining] = useState<Joining | null>(null)
  const [failure, setFailure] = useState<JoinFailure | null>(null)
  /** The address a `202` says it mailed, and when Resend opens again; null until a verify answers `202`. */
  const [inbox, setInbox] = useState<{ email: string; resendAt: number } | null>(null)
  const started = useRef(false)

  const invitation = preview.data
  const gone = !invitation && preview.isError && statusFrom(preview.error) === 404
  const nextCall = joinCallFor(invitation, gone, startedAs)

  /** Toasts the join and opens its tenant in place of this page. */
  const land = (tenant: JoinedTenant, account: string, alreadyMember: boolean) => {
    setFailure(null)
    landJoined(tenant, account, alreadyMember, ({ slug }) => {
      void navigate({ to: '/tenants/$slug', params: { slug }, replace: true })
    })
  }

  /** Keeps a failure in page state, so the panel and its focus stay while Try again runs. */
  const failWith = (call: JoinCall, error: unknown) => {
    const status = statusFrom(error)
    const dead = status === 404 || (call === 'accept' && status === 403)
    setFailure(dead ? { kind: 'dead' } : { kind: 'failed', error })
  }

  /** A verify's answer: joined in one click lands; a `202` shows the inbox and restarts the resend clock. */
  const verified = (result: InvitationVerifyResult) => {
    setFailure(null)
    if (isConfirmationSent(result)) {
      setInbox({ email: result.email, resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1_000 })
      return
    }
    land(result.tenant, result.user.email, false)
  }

  /** Posts the token; a 404 (and, for accept, a 403) is the dead invitation, anything else may pass. */
  const post = (call: JoinCall) => {
    if (call === 'verify') {
      verify.mutate(token, { onSuccess: verified, onError: (error) => failWith(call, error) })
    } else if (startedAs) {
      // The bearer is startedAs's session, whose address the server confirmed when it signed them in.
      const account = startedAs.email
      accept.mutate(token, {
        onSuccess: ({ tenant, alreadyMember }) => land(tenant, account, alreadyMember),
        onError: (error) => failWith(call, error),
      })
    }
  }

  /**
   * Another tab opened the confirmation link and this tab restored the shared
   * session. The message carries no data, so the page lands on the invitation's
   * tenant only when the restored account is the address the `202` named, and
   * otherwise opens the dashboard with no join toast. The confirming tab
   * already tracked the sign-in, and nothing is posted here.
   */
  const confirmedElsewhere = async (waitingOn: InvitationPreview, mailed: string) => {
    const account = useAuthStore.getState().user?.email
    if (!account || account.toLowerCase() !== mailed.toLowerCase()) {
      void navigate({ to: ROUTES.dashboard, replace: true })
      return
    }
    // A failed refresh still lands: the tenant route loads its own data.
    await refreshJoinedTenant(queryClient, waitingOn.tenant.slug).catch(() => undefined)
    land(waitingOn.tenant, account, false)
  }

  /**
   * Resend from "Check your inbox": the same verify with the same token. A rate
   * limit keeps the inbox, says how long to wait and holds Resend for that
   * long; any other failure is handled as the first verify's would be.
   */
  const resend = () => {
    verify.mutate(token, {
      onSuccess: verified,
      onError: (error) => {
        if (statusFrom(error) !== 429) {
          failWith('verify', error)
          return
        }
        toast.error(retryableFailureMessage(error, 'attempts'))
        const wait = retryAfterSecondsFrom(error)
        if (wait === null) return
        setInbox(
          (current) =>
            current && {
              ...current,
              resendAt: Math.max(current.resendAt, Date.now() + wait * 1_000),
            }
        )
      },
    })
  }

  const start = useEffectEvent(() => {
    if (started.current || !nextCall) return
    started.current = true
    setJoining({ call: nextCall, invitation: invitation ?? null })
    post(nextCall)
  })

  useEffect(() => {
    start()
  }, [nextCall])

  if (joining) {
    if (failure?.kind === 'dead') return <DeadInvitation inviter={joining.invitation?.invitedBy} />
    if (failure) {
      const title = joining.invitation
        ? `We couldn’t add you to ${joining.invitation.tenant.name}`
        : 'We couldn’t open this invitation'
      return (
        <InvitationCard title={title}>
          <VerifyFailedPanel
            message={retryableFailureMessage(failure.error, 'attempts')}
            retrying={joining.call === 'verify' ? verify.isPending : accept.isPending}
            onRetry={() => post(joining.call)}
          />
        </InvitationCard>
      )
    }
    if (inbox && joining.invitation) {
      const waitingOn = joining.invitation
      return (
        <InvitationInbox
          email={inbox.email}
          tenantName={waitingOn.tenant.name}
          resendAt={inbox.resendAt}
          resending={verify.isPending}
          onResend={resend}
          onSignedIn={() => void confirmedElsewhere(waitingOn, inbox.email)}
        />
      )
    }
    return <JoiningFrame invitation={joining.invitation} />
  }

  // The frame the effect is about to fill, so the first paint already shows the join.
  if (nextCall) return <JoiningFrame invitation={invitation ?? null} />

  if (invitation && startedAs) {
    return <SwitchInvitation token={token} invitation={invitation} currentEmail={startedAs.email} />
  }

  if (gone) return <DeadInvitation inviter={undefined} />

  if (preview.isError) {
    return (
      <InvitationCard title="We could not load this invitation">
        <div className="grid gap-3">
          <LoadError message={PREVIEW_ERROR} onRetry={() => void preview.refetch()} />
          <HomeLink />
        </div>
      </InvitationCard>
    )
  }

  return (
    <InvitationCard title="Checking your invitation">
      <div className="grid gap-3">
        <Skeleton className="h-4 w-3/4 justify-self-center" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </InvitationCard>
  )
}

/** Chooses the state for the `?token=` value: missing, malformed, or a token to look up. */
function AcceptInvitationPage() {
  const { token } = Route.useSearch()

  if (!token) {
    return (
      <InvitationCard
        title="This link is incomplete"
        description="The invitation link is missing its token. Open the most recent invitation email and use its link."
      >
        <HomeLink />
      </InvitationCard>
    )
  }
  if (!invitationTokenSchema.safeParse(token).success) {
    return <DeadInvitation inviter={undefined} />
  }
  return <InvitationForToken token={token} />
}
