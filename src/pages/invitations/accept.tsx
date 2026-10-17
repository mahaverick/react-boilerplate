import '@/lib/zod-jitless'
import { IconAlertCircle } from '@tabler/icons-react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { BusyButton } from '@/components/shared/busy-button'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useLogout } from '@/queries/auth.queries'
import {
  inviterName,
  useAcceptInvitation,
  useInvitationPreview,
} from '@/queries/invitation.queries'
import { invitationTokenSchema } from '@/schemas/invitation.schemas'
import { useAuthStore } from '@/states/auth.store'
import { INVITATION_EMAIL_UNVERIFIED, type InvitationPreview } from '@/types/api.types'

/**
 * The invitation landing page. Top level, under neither `_auth` nor `_app`:
 * the link is opened signed out and signed in alike, and each guard would
 * bounce one of them. The API mails links to this fixed path. It renders
 * `AuthLayout` itself, like reset-password.tsx. `.catch` treats a non-string
 * `?token=` as none, since the router JSON-parses search values.
 */
export const Route = createFileRoute('/invitations/accept')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Accept invitation') }] }),
  component: AcceptInvitationPage,
  pendingComponent: AuthPagePending,
})

/** The server's own 404 copy, reused when the link is malformed locally. */
const INVALID_MESSAGE = 'This invitation is invalid or has expired.'

const PREVIEW_ERROR =
  'We could not load this invitation. The request failed, which is not the same as the invitation being invalid.'

/** Where this page lives, token included, for the round trips that leave it. */
function acceptHref(token: string): string {
  return `${ROUTES.invitationAccept}?token=${encodeURIComponent(token)}`
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

/** Every state's frame: one `<main>` (AuthLayout) and one `<h1>`. */
function InvitationCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <AuthLayout>
      <AuthCard title={title} description={description}>
        {children}
      </AuthCard>
    </AuthLayout>
  )
}

/** The way out of every state that is not signing in, signing out or accepting. */
function HomeLink() {
  return (
    <Link to={ROUTES.home} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
      Go to the home page
    </Link>
  )
}

/** The panel for a link that cannot be used: malformed, revoked, expired or already used. */
function InvalidInvitation({ message }: { message: string }) {
  return (
    <InvitationCard title="This invitation can’t be used" description={message}>
      <HomeLink />
    </InvitationCard>
  )
}

/** Signed out: log in (returning here) or create an account with the invited address. */
function SignedOut({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <div className="grid gap-3">
        <Link
          to={ROUTES.login}
          search={{ redirect: acceptHref(token) }}
          className={cn(buttonVariants(), 'w-full')}
        >
          Log in
        </Link>
        <Link
          to={ROUTES.register}
          search={{ email: invitation.email }}
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          Create account
        </Link>
        <p className="text-sm text-muted-foreground">
          New here? Create an account with <Pii>{invitation.email}</Pii>, verify it from your inbox,
          then open this invitation link again.
        </p>
      </div>
    </InvitationCard>
  )
}

/**
 * Signed in as a different address. Signing out returns here signed out, the
 * state that offers "Log in". The home link is a way out that is not signing
 * out, and the state's only link, which axe's `bypass` rule needs to apply at
 * all.
 */
function WrongAccount({
  token,
  invitation,
  currentEmail,
}: {
  token: string
  invitation: InvitationPreview
  currentEmail: string
}) {
  const logout = useLogout({ returnTo: acceptHref(token) })

  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <div className="grid gap-3">
        <p className="text-sm">
          This invitation was sent to <Pii>{invitation.email}</Pii>. You’re signed in as{' '}
          <Pii>{currentEmail}</Pii>.
        </p>
        <BusyButton
          busy={logout.isPending}
          busyLabel="Signing out…"
          className="w-full"
          onClick={() => logout.mutate()}
        >
          Sign out
        </BusyButton>
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

/**
 * The accept button for the invited account. The API's 403 is kept as a
 * refusal (with the verify hint when the email is unverified), and its 404
 * (revoked, expired or used since the preview) replaces the panel. A repeat
 * accept by the same member also succeeds. The success toast names no role,
 * because the response carries the member's current role, which for an
 * existing member is not the one offered. The home link is a way out that is
 * not accepting, and the state's only link, which axe's `bypass` rule needs to
 * apply at all.
 */
function AcceptPanel({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAcceptInvitation()
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<{ message: string; unverified: boolean } | null>(null)
  const [gone, setGone] = useState<string | null>(null)

  /** Accepts the invitation, then opens the tenant; a 404 or 403 becomes a panel state, other failures a toast. */
  async function onAccept() {
    setRefusal(null)
    try {
      const { tenant } = await accept.mutateAsync(token)
      toast.success(`You joined ${tenant.name}.`)
      await navigate({ to: '/tenants/$slug', params: { slug: tenant.slug } })
    } catch (error) {
      const status = statusFrom(error)
      if (status === 404) {
        setGone(messageFrom(error))
        return
      }
      if (status === 403) {
        setRefusal({
          message: messageFrom(error),
          unverified: codeFrom(error) === INVITATION_EMAIL_UNVERIFIED,
        })
        return
      }
      toast.error(messageFrom(error))
    }
  }

  if (gone) return <InvalidInvitation message={gone} />

  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <div className="grid gap-3">
        {refusal && (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertTitle>{refusal.message}</AlertTitle>
            {refusal.unverified && (
              <AlertDescription>
                Use the link in your verification email, then open this invitation link again.
              </AlertDescription>
            )}
          </Alert>
        )}
        <BusyButton
          busy={accept.isPending}
          busyLabel="Accepting…"
          className="w-full"
          onClick={() => void onAccept()}
        >
          Accept invitation
        </BusyButton>
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

/**
 * The page for a well-formed token: the preview, then the state for who is
 * signed in. Only a 404 marks the invitation unusable; any other preview
 * failure is a failed request, with a retry.
 */
function InvitationForToken({ token }: { token: string }) {
  const preview = useInvitationPreview(token)
  const user = useAuthStore((state) => state.user)

  if (preview.isPending) {
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

  if (preview.isError) {
    if (statusFrom(preview.error) === 404) {
      return <InvalidInvitation message={messageFrom(preview.error)} />
    }
    return (
      <InvitationCard title="We could not load this invitation">
        <div className="grid gap-3">
          <LoadError message={PREVIEW_ERROR} onRetry={() => void preview.refetch()} />
          <HomeLink />
        </div>
      </InvitationCard>
    )
  }

  const invitation = preview.data
  if (!user) return <SignedOut token={token} invitation={invitation} />
  // Case-insensitive: neither side is trusted to stay lowercased. A mismatch never reaches the server.
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return <WrongAccount token={token} invitation={invitation} currentEmail={user.email} />
  }
  return <AcceptPanel token={token} invitation={invitation} />
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
    return <InvalidInvitation message={INVALID_MESSAGE} />
  }
  return <InvitationForToken token={token} />
}
