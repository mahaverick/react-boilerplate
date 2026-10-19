/**
 * @file The parts both invitation pages draw, the accept page and the confirm
 * page. Shared with apex byte for byte, with `land-joined.ts`: nothing here
 * names an app's own landing, so each page passes its own.
 */
import { Link } from '@tanstack/react-router'
import { useId, useRef, useState, type ReactNode } from 'react'
import { CHECK_INBOX_TITLE, SignInLinkForm } from '@/components/features/auth/sign-in-link-form'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { buttonVariants } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'
import { useCountdown } from '@/hooks/use-countdown'
import { formatClock } from '@/lib/countdown'
import { cn } from '@/lib/utils'

/** The title of a confirmation link the server refused, whatever the reason. */
export const CONFIRM_DEAD_TITLE = "This link can't be used"

/** Every invitation state's frame: one `<main>` (AuthLayout) and one `<h1>`. */
export function InvitationCard({
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

/** The way out of the states that are not joining. */
export function HomeLink() {
  return (
    <Link to={ROUTES.home} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
      Go to the home page
    </Link>
  )
}

/**
 * "Check your inbox" after a verify answered `202`: the server mailed a
 * confirmation link to `email`, the invited address from that answer, never
 * from the URL. Resend waits out a local countdown that the page restarts at
 * each `202`; the server never says its own cooldown. Focus lands on Resend
 * as the state appears, as on the sign-in form's inbox step, and the button
 * carries the status line in case the region is not announced.
 */
export function InvitationInbox({
  email,
  tenantName,
  resendAt,
  resending,
  onResend,
}: {
  email: string
  tenantName: string
  /** The epoch-ms time Resend opens again. */
  resendAt: number | null
  resending: boolean
  onResend: () => void
}) {
  const left = useCountdown(resendAt)
  const sentLineId = useId()
  const focused = useRef(false)

  /** Takes focus once, as the state mounts, unless the person has already moved it. */
  const takeFocus = (element: HTMLElement | null) => {
    if (!element || focused.current) return
    focused.current = true
    const active = document.activeElement
    if (active === null || active === document.body) element.focus()
  }

  return (
    <InvitationCard title={CHECK_INBOX_TITLE}>
      <div className="grid gap-4 text-center text-sm">
        <p id={sentLineId} role="status">
          We sent a link to <Pii>{email}</Pii>.
        </p>
        <p className="text-muted-foreground">
          Open it to join {tenantName}. The link works once and expires in 15 minutes.
        </p>
        <BusyButton
          ref={takeFocus}
          aria-describedby={sentLineId}
          busy={resending}
          busyLabel="Sending…"
          variant="outline"
          className="w-full"
          disabled={left > 0}
          focusableWhenDisabled
          onClick={() => {
            if (left === 0) onResend()
          }}
        >
          {left > 0 ? `Resend in ${formatClock(left)}` : 'Resend link'}
        </BusyButton>
        <HomeLink />
      </div>
    </InvitationCard>
  )
}

/** A confirmation link that lacks its token or its address: nothing to post. */
export function ConfirmLinkIncomplete() {
  return (
    <InvitationCard
      title="This link is incomplete"
      description="The link is missing part of its address. Open the most recent email from us and use its link."
    >
      <HomeLink />
    </InvitationCard>
  )
}

/**
 * A confirmation link that cannot join anyone: malformed, or refused by the
 * server for any reason, which it does not say. Someone signed in when it
 * appeared gets `signedInAction`, such as a link to their dashboard. Anyone
 * else gets a sign-in form prefilled with the link's address. The form keeps
 * its place in the tree when it switches to "Check your inbox", so its resend
 * clock survives.
 */
export function ConfirmLinkDead({
  email,
  signedInAction,
  onSignedIn,
}: {
  /** The link's `email` hint; it only prefills the form. */
  email: string | undefined
  /** What a signed-in visitor gets instead of the form; null for a signed-out one. */
  signedInAction: ReactNode
  /** Called once another tab signed this browser in from the form's link. */
  onSignedIn: () => void
}) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const description =
    'Open your invitation email and select Join again to get a new link. If the invitation expired, ask the team for a new invite.'
  if (signedInAction) {
    return (
      <InvitationCard title={CONFIRM_DEAD_TITLE} description={description}>
        {signedInAction}
      </InvitationCard>
    )
  }
  return (
    <InvitationCard
      title={sentTo ? CHECK_INBOX_TITLE : CONFIRM_DEAD_TITLE}
      description={sentTo ? undefined : description}
    >
      <div className="grid gap-3">
        {sentTo ? null : <p className="text-sm">Or sign in:</p>}
        <SignInLinkForm
          sentTo={sentTo}
          onSentToChange={setSentTo}
          defaultEmail={email}
          onSignedIn={onSignedIn}
        />
        <HomeLink />
      </div>
    </InvitationCard>
  )
}
