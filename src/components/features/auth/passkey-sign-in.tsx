import { BusyButton } from '@/components/shared/busy-button'
import { passkeySignInMessage } from '@/lib/passkey-sign-in-message'
import { toast } from '@/lib/toast'
import { cancelPasskeyPrompt, passkeyFailure } from '@/lib/webauthn'
import { track } from '@/observability/telemetry'
import { usePasskeySignIn, usePasskeySupport } from '@/queries/passkey.queries'

/**
 * "Sign in with a passkey": opens the browser's passkey sheet. It renders only
 * where the browser can use passkeys. Starting the prompt cancels a pending
 * autofill request, even one that has not opened its ceremony yet. A dismissed prompt
 * is tracked and says nothing; any other failure toasts.
 *
 * @param props.onSignedIn - Called once the passkey signed this tab in.
 * @param props.onModalSettled - Called when the prompt ended without a sign-in, so the page can restart autofill.
 */
export function PasskeySignInButton({
  onSignedIn,
  onModalSettled,
}: {
  onSignedIn: () => void
  onModalSettled: () => void
}) {
  const { create } = usePasskeySupport(true)
  const signIn = usePasskeySignIn()
  if (!create) return null

  /** Runs the prompt and routes its outcome. */
  const start = async () => {
    // Ends a pending autofill first, including one still fetching its options, so it cannot start after this sheet and abort it.
    cancelPasskeyPrompt()
    try {
      await signIn.mutateAsync('modal')
    } catch (error) {
      if (passkeyFailure(error) === 'cancelled') {
        track('passkey_prompt_cancelled', { ceremony: 'sign_in' })
      } else {
        toast.error(passkeySignInMessage(error))
      }
      onModalSettled()
      return
    }
    onSignedIn()
  }

  return (
    <BusyButton
      type="button"
      variant="outline"
      className="w-full"
      busy={signIn.isPending}
      busyLabel="Waiting for your passkey…"
      onClick={() => void start()}
    >
      Sign in with a passkey
    </BusyButton>
  )
}
