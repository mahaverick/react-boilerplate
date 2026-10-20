import { lazy, Suspense } from 'react'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { AppLayout } from '@/components/layouts/app-layout'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'

/** Required mode's setup screen, loaded only for the account that needs it. */
const PasskeySetupScreen = lazy(() =>
  import('@/components/features/passkeys/passkey-setup-screen').then((m) => ({
    default: m.PasskeySetupScreen,
  }))
)

/**
 * The signed-in shell's component: `AppLayout` inside the providers every
 * signed-in page needs. `StepUpProvider` owns the one "Confirm it's you"
 * dialog, so a write refused for a stale sign-in asks from any page. While
 * required mode holds the account (`PASSKEY_SETUP_REQUIRED`), the setup screen
 * takes the layout's place, so the notification stream, the tenant guard and
 * every shell query unmount; the URL stays, and the layout returns when the
 * passkey exists.
 */
export function AppShell() {
  const required = usePasskeySetupStore((s) => s.required)
  return (
    <StepUpProvider>
      {required ? (
        <Suspense fallback={null}>
          <PasskeySetupScreen />
        </Suspense>
      ) : (
        <AppLayout />
      )}
    </StepUpProvider>
  )
}
