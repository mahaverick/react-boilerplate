import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
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
 * Top level on purpose, under neither `_auth` nor `_app`: the link is opened
 * signed out and signed in alike, and each guard would bounce one of them.
 * The backend mails `${WEB_URL}/invitations/accept?token=`, so the path is
 * fixed. This page renders `AuthLayout` itself, like reset-password.tsx.
 */
export const Route = createFileRoute('/invitations/accept')({
  // `.catch`: the router JSON-parses search values, so `?token=123` is a
  // number, treated as no token.
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  component: AcceptInvitationPage,
})

/** The server's own 404 copy, reused when the link is malformed locally. */
const INVALID_MESSAGE = 'This invitation is invalid or has expired.'

const PREVIEW_ERROR =
  'We could not load this invitation. The request failed, which is not the same as the invitation being invalid.'

/** Where this page lives, token included, for the round trips that leave it. */
function acceptHref(token: string): string {
  return `${ROUTES.invitationAccept}?token=${encodeURIComponent(token)}`
}

/** "{inviter} invited you to join {tenant} as {role}." */
function invitationSentence(invitation: InvitationPreview): string {
  return `${inviterName(invitation.invitedBy)} invited you to join ${invitation.tenant.name} as ${ROLE_LABELS[invitation.role]}.`
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
      <Card>
        <CardHeader>
          {/* CardTitle renders a div, so the page's h1 goes inside it. */}
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </AuthLayout>
  )
}

function HomeLink() {
  return (
    <Link to={ROUTES.home} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
      Go to the home page
    </Link>
  )
}

function InvalidInvitation({ message }: { message: string }) {
  return (
    <InvitationCard title="This invitation can’t be used" description={message}>
      <HomeLink />
    </InvitationCard>
  )
}

function SignedOut({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <div className="grid gap-3">
        {/* Links styled as buttons: both navigate. */}
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
          New here? Create an account with {invitation.email}, verify it from your inbox, then open
          this invitation link again.
        </p>
      </div>
    </InvitationCard>
  )
}

function WrongAccount({
  token,
  invitation,
  currentEmail,
}: {
  token: string
  invitation: InvitationPreview
  currentEmail: string
}) {
  // Back to this page, signed out, which is the state that offers "Log in".
  const logout = useLogout({ returnTo: acceptHref(token) })

  return (
    <InvitationCard
      title={`Join ${invitation.tenant.name}`}
      description={invitationSentence(invitation)}
    >
      <div className="grid gap-3">
        <p className="text-sm">
          This invitation was sent to {invitation.email}. You’re signed in as {currentEmail}.
        </p>
        <Button className="w-full" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
        {/* A way out that isn't signing out; also the state's only link, without
            which axe's `bypass` rule has nothing to apply to. */}
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

function AcceptPanel({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAcceptInvitation()
  const navigate = useNavigate()
  // The server's 403: unverified (the verify hint applies) or, despite the
  // local match, a different address (its message alone).
  const [refusal, setRefusal] = useState<{ message: string; unverified: boolean } | null>(null)
  // The server's 404: revoked, expired or used since the preview loaded.
  const [gone, setGone] = useState<string | null>(null)

  async function onAccept() {
    setRefusal(null)
    try {
      // A repeat accept by the same member also succeeds, so "already a
      // member" lands here too.
      const { tenant } = await accept.mutateAsync(token)
      // No role here: the response carries the member's CURRENT role, which
      // for an existing member is not the one this invitation offered.
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
          <div role="alert" className="grid gap-1 text-sm">
            <p className="text-destructive">{refusal.message}</p>
            {refusal.unverified && (
              <p className="text-muted-foreground">
                Use the link in your verification email, then open this invitation link again.
              </p>
            )}
          </div>
        )}
        <Button className="w-full" disabled={accept.isPending} onClick={() => void onAccept()}>
          {accept.isPending ? 'Accepting…' : 'Accept invitation'}
        </Button>
        {/* A way out that isn't accepting; also the state's only link, without
            which axe's `bypass` rule has nothing to apply to. */}
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

function InvitationForToken({ token }: { token: string }) {
  const preview = useInvitationPreview(token)
  const user = useAuthStore((state) => state.user)

  if (preview.isPending) {
    return (
      <InvitationCard title="Checking your invitation">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-full" />
        </div>
      </InvitationCard>
    )
  }

  if (preview.isError) {
    // Only a 404 means the invitation is unusable. Anything else is a failed
    // request, and saying "invalid" about it would be a claim we cannot make.
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
  // Case-insensitive: both sides are stored lowercased, and neither is
  // trusted to stay that way. A mismatch never reaches the server.
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return <WrongAccount token={token} invitation={invitation} currentEmail={user.email} />
  }
  return <AcceptPanel token={token} invitation={invitation} />
}

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
