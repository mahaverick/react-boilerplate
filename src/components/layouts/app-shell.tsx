import { lazy, Suspense } from 'react'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { AppLayout } from '@/components/layouts/app-layout'
import { LazyBoundary } from '@/components/shared/lazy-boundary'
import { Button } from '@/components/ui/button'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'

/** Required mode's setup screen, loaded only for the account that needs it. */
const PasskeySetupScreen = lazy(() =>
  import('@/components/features/passkeys/passkey-setup-screen').then((m) => ({
    default: m.PasskeySetupScreen,
  }))
)

/** What shows when the setup screen's code cannot load: the account has no other way forward, so a reload is the retry. */
function SetupScreenLoadFailed() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Create your passkey</h1>
      <p>We couldn’t load this page. Reload to try again.</p>
      <Button type="button" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </main>
  )
}

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
        <LazyBoundary fallback={<SetupScreenLoadFailed />}>
          <Suspense fallback={null}>
            <PasskeySetupScreen />
          </Suspense>
        </LazyBoundary>
      ) : (
        <AppLayout />
      )}
    </StepUpProvider>
  )
}
