/**
 * @file The cross-tab half of an invitation's "Check your inbox". Shared with
 * apex byte for byte, with `invitation-parts.tsx`.
 */
import { useEffect, useEffectEvent } from 'react'
import { ensureSession, subscribeAuthMessage } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'

/**
 * Listens, while `listening`, for another tab's `signed_in`, sent after that
 * tab opened the confirmation link. A tab that is still signed out restores
 * the shared session and calls `onSignedIn`; a tab already signed in ignores
 * it. The page owns this, not "Check your inbox", because the mailed link
 * keeps working while a failed Resend shows its Try again panel.
 * @param listening - Whether a confirmation link is out, mailed by a `202`.
 * @param onSignedIn - Called once another tab signed this browser in and ensureSession() resolved.
 */
export function useSignedInElsewhere(listening: boolean, onSignedIn: () => void) {
  const signedIn = useEffectEvent(() => onSignedIn())

  useEffect(() => {
    if (!listening) return
    let restoring = false
    // A restore that settles after the listener stops must not navigate.
    let active = true
    const unsubscribe = subscribeAuthMessage('signed_in', () => {
      // A tab already signed in has its own session; restoring would only race it.
      if (restoring || useAuthStore.getState().isAuthenticated) return
      restoring = true
      ensureSession().then(
        () => {
          if (active) signedIn()
        },
        () => {
          restoring = false
        }
      )
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [listening])
}
