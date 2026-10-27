import { useEffect, useEffectEvent, useRef } from 'react'
import { codeFrom } from '@/lib/api-error'
import { passkeySignInMessage } from '@/lib/passkey-sign-in-message'
import { toast } from '@/lib/toast'
import { cancelPasskeyPrompt } from '@/lib/webauthn'
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
 * - before a pick, every failure ends quietly. Nobody asked for the request,
 *   so a cancel, a failed options fetch, or a browser that answers
 *   `NotSupportedError` (headless Chrome with no authenticator) raises nothing
 *   on page load; the button reports its own failures;
 * - once the browser hands back a passkey the person picked, they asked: the
 *   first `PASSKEY_VERIFICATION_FAILED` restarts once with fresh options, with
 *   no toast, because options older than 5 minutes fail this way, and every
 *   other failure toasts, a malformed answer included.
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
  // Whether the running request got a pick: set by the sign-in, reset at each start.
  const picked = useRef(false)
  const signIn = usePasskeySignIn({
    onPicked: () => {
      picked.current = true
    },
  })
  const signInWithAutofill = useEffectEvent(() => signIn.mutateAsync('autofill'))
  const landed = useEffectEvent(onSignedIn)
  const active = enabled && autofill

  useEffect(() => {
    if (!active) return
    let live = true

    /** Runs one autofill sign-in; `retried` is whether a stale pick already restarted it. */
    const run = async (retried: boolean): Promise<void> => {
      picked.current = false
      try {
        await signInWithAutofill()
        if (live) landed()
      } catch (error) {
        if (!live || !picked.current) return
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
