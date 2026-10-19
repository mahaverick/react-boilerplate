import { IconAlertCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * The verifying frame of a link page: one `role="status"` row with a spinner
 * and `label`, such as "Signing you in…". The label may carry a masked
 * address inline, as "Joining Acme as <Pii>ada@…</Pii>…" does. With `email`, a
 * second line names the account the link signs in, so a person who opened
 * someone else's link sees whose account it is before it lands. Pass the
 * link's own address or the invitation's; the address is masked.
 */
export function SigningInStatus({ label, email }: { label: ReactNode; email?: string | null }) {
  return (
    <div role="status" className="grid justify-items-center gap-2 py-4 text-center text-sm">
      <span className="flex items-center gap-2">
        {/* The row is the live region; the spinner's own status role would announce "Loading" over the label. */}
        <Spinner aria-hidden="true" />
        {label}
      </span>
      {email && (
        <span className="text-muted-foreground">
          This link is for <Pii>{email}</Pii>.
        </span>
      )}
    </div>
  )
}

/** What the switch-account panel needs: whose session this is, whose link, and the two ways out. */
interface SwitchAccountPanelProps {
  /** A sign-in link offers "Stay signed in as …"; an invitation offers "Cancel". */
  kind: 'link' | 'invitation'
  currentEmail: string
  /** null when the link carried no address. */
  targetEmail: string | null
  /** True while the sign-out for the switch runs. */
  continuing: boolean
  onContinue: () => void
  onStay: () => void
}

/**
 * Asks a signed-in person before a link for another account signs them out.
 * Nothing is spent until they choose Continue, and both addresses are masked.
 */
export function SwitchAccountPanel({
  kind,
  currentEmail,
  targetEmail,
  continuing,
  onContinue,
  onStay,
}: SwitchAccountPanelProps) {
  const current = <Pii>{currentEmail}</Pii>
  const target = targetEmail ? <Pii>{targetEmail}</Pii> : 'another account'
  return (
    <div className="grid gap-4">
      {kind === 'link' ? (
        <p className="text-sm">
          You’re signed in as {current}. This link is for {target}.
        </p>
      ) : (
        <p className="text-sm">
          This invitation is for {target}. You’re signed in as {current}.
        </p>
      )}
      <div className="grid gap-2">
        <BusyButton
          busy={continuing}
          busyLabel="Signing out…"
          focusableWhenDisabled
          onClick={onContinue}
          className="w-full"
        >
          {targetEmail ? <>Continue as {target}</> : 'Continue with this link'}
        </BusyButton>
        <Button variant="outline" disabled={continuing} onClick={onStay} className="w-full">
          {kind === 'link' ? <>Stay signed in as {current}</> : 'Cancel'}
        </Button>
      </div>
    </div>
  )
}

/**
 * A verify that failed for a reason that may pass: a rate limit, maintenance,
 * a network error or a server error. The link is still good, so the panel
 * offers Try again rather than a new link.
 */
export function VerifyFailedPanel({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div className="grid gap-4">
      <Alert variant="destructive">
        <IconAlertCircle aria-hidden="true" />
        <AlertDescription className="min-w-0 wrap-anywhere">{message}</AlertDescription>
      </Alert>
      <BusyButton
        busy={retrying}
        busyLabel="Trying again…"
        focusableWhenDisabled
        onClick={onRetry}
        className="w-full"
      >
        Try again
      </BusyButton>
    </div>
  )
}
