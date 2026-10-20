import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { BusyButton } from '@/components/shared/busy-button'
import { pageTitle } from '@/constants/app'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { createFailureMessage } from '@/lib/passkey-create-failure'
import { finishPasskeySetup } from '@/lib/passkey-setup'
import { toast } from '@/lib/toast'
import { useLogout, useLogoutPending } from '@/queries/auth.queries'
import { useCreatePasskey, usePasskeyCreateSupport } from '@/queries/passkey-manage.queries'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'

const TITLE = 'Create your passkey'
const UNSUPPORTED =
  'This browser can’t create passkeys. Sign in on a current version of Chrome, Edge, Firefox or Safari to continue.'

/**
 * The full page that stands in for the app while required mode holds an account
 * with no passkey: the server's message as it arrived, Create a passkey, and
 * Sign out. Creating runs through the "Confirm it’s you" step-up, which opens on
 * the email link (this account has no passkey to confirm with). When the passkey
 * exists the flag clears and the page the user was on renders again, on the same
 * URL. Without WebAuthn it explains why and keeps Sign out. Nothing here depends
 * on the app, so apex shows the same screen.
 */
export function PasskeySetupScreen() {
  const message = usePasskeySetupStore((s) => s.message)
  const router = useRouter()
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const create = useCreatePasskey()
  const support = usePasskeyCreateSupport()
  const logout = useLogout()
  const signingOut = useLogoutPending()

  // The screen replaces the routed page, so the route's own title no longer applies.
  useEffect(() => {
    const previous = document.title
    document.title = pageTitle(TITLE)
    return () => {
      document.title = previous
    }
  }, [])

  const unsupported = support.known && !support.create

  return (
    <>
      <SkipLink />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto grid min-h-svh max-w-md content-center justify-items-start gap-4 p-6 outline-none"
      >
        <h1 className="text-2xl font-semibold">{TITLE}</h1>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {unsupported ? <p className="text-sm">{UNSUPPORTED}</p> : null}
        <div className="flex flex-wrap gap-2">
          {unsupported ? null : (
            <BusyButton
              busy={create.isPending || stepping}
              busyLabel={stepping ? STEP_UP_WAITING_LABEL : 'Creating…'}
              disabled={!support.known || signingOut}
              onClick={() => {
                stepUp
                  .run(() => create.mutateAsync())
                  .then(
                    () => {
                      toast.success('Passkey created.')
                      return finishPasskeySetup(router, queryClient)
                    },
                    (error: unknown) => {
                      const failure = createFailureMessage(error)
                      if (failure !== null) toast.error(failure)
                    }
                  )
              }}
            >
              Create a passkey
            </BusyButton>
          )}
          <BusyButton
            variant="outline"
            busy={signingOut}
            busyLabel="Signing out…"
            onClick={() => {
              logout.mutate()
            }}
          >
            Sign out
          </BusyButton>
        </div>
      </main>
    </>
  )
}
