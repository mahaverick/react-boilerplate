import { AxiosError } from 'axios'
import { useEffect, useEffectEvent } from 'react'
import { codeFrom } from '@/lib/api-error'
import { passkeySignInMessage } from '@/lib/passkey-sign-in-message'
import { toast } from '@/lib/toast'
import { cancelPasskeyPrompt } from '@/lib/webauthn'
import { usePasskeySignIn, usePasskeySupport } from '@/queries/passkey.queries'
import { PASSKEY_VERIFICATION_FAILED } from '@/types/passkey.types'

/** The request that sends a picked passkey; only its failures come after the person acted. */
const SIGN_IN_VERIFY = '/auth/passkeys/sign-in/verify'

/**
 * Whether a failed autofill sign-in failed on the server's check of a passkey
 * the person picked, rather than before any pick (the options request or the
 * browser's own refusal, which nobody asked for).
 * @param error - What the sign-in rejected with.
 */
function refusedPick(error: unknown): boolean {
  return error instanceof AxiosError && error.config?.url === SIGN_IN_VERIFY
}

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
 * - before a pick, every failure ends quietly. Nobody asked for the request,
 *   so a cancel, a failed options fetch, or a browser that answers
 *   `NotSupportedError` (headless Chrome with no authenticator) raises nothing
 *   on page load; the button reports its own failures;
 * - once a passkey is picked, the person asked: the first
 *   `PASSKEY_VERIFICATION_FAILED` restarts once with fresh options, with no
 *   toast, because options older than 5 minutes fail this way, and every
 *   other refusal of the pick toasts.
 *
 * It starts after a microtask, so a mount discarded at once (StrictMode, a fast
 * unmount) starts nothing: the sign-in reads its cancel count only when it
 * begins, which would be after that cleanup's cancel.
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
        if (!live || !refusedPick(error)) return
        if (!retried && codeFrom(error) === PASSKEY_VERIFICATION_FAILED) {
          await run(true)
          return
        }
        toast.error(passkeySignInMessage(error))
      }
    }

    // A microtask later: see the hook's JSDoc.
    void Promise.resolve().then(() => (live ? run(false) : undefined))
    return () => {
      live = false
      cancelPasskeyPrompt()
    }
  }, [active, restartKey])
}
