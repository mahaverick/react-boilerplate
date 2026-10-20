import { useEffect, useEffectEvent } from 'react'
import { codeFrom } from '@/lib/api-error'
import { passkeySignInMessage } from '@/lib/passkey-sign-in-message'
import { toast } from '@/lib/toast'
import { cancelPasskeyPrompt, passkeyFailure } from '@/lib/webauthn'
import { usePasskeySignIn, usePasskeySupport } from '@/queries/passkey.queries'
import { PASSKEY_VERIFICATION_FAILED } from '@/types/passkey.types'

/** What a page hands the autofill hook. */
interface PasskeyAutofillOptions {
  /** True while the email field is on screen and passkeys are on. */
  enabled: boolean
  /** Called once a passkey picked from the browser's autofill signed this tab in. */
  onSignedIn: () => void
  /** Change it to start a fresh autofill request, such as after the button's prompt ended without a sign-in. */
  restartKey?: number
}

/**
 * Offers the browser's passkey autofill behind the page's email field
 * (`autocomplete="username webauthn"`). While `enabled` and the browser
 * supports autofill, it asks for options and waits for a pick:
 *
 * - a cancelled request ends quietly: another prompt took over, or the person dismissed it;
 * - the first `PASSKEY_VERIFICATION_FAILED` restarts once with fresh options, with no toast, because options older than 5 minutes fail this way;
 * - every other failure toasts.
 *
 * Cleanup (an unmount, or `enabled` going false) cancels the pending request.
 */
export function usePasskeyAutofill({
  enabled,
  onSignedIn,
  restartKey = 0,
}: PasskeyAutofillOptions): void {
  const { autofill } = usePasskeySupport(enabled)
  const signIn = usePasskeySignIn()
  const signInWithAutofill = useEffectEvent(() => signIn.mutateAsync('autofill'))
  const landed = useEffectEvent(onSignedIn)
  const active = enabled && autofill

  useEffect(() => {
    if (!active) return
    let live = true

    /** Runs one autofill sign-in; `retried` is whether a stale pick already restarted it. */
    const run = async (retried: boolean): Promise<void> => {
      try {
        await signInWithAutofill()
        if (live) landed()
      } catch (error) {
        if (!live || passkeyFailure(error) === 'cancelled') return
        if (!retried && codeFrom(error) === PASSKEY_VERIFICATION_FAILED) {
          await run(true)
          return
        }
        toast.error(passkeySignInMessage(error))
      }
    }

    void run(false)
    return () => {
      live = false
      cancelPasskeyPrompt()
    }
  }, [active, restartKey])
}
