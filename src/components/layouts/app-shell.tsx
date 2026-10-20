import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { AppLayout } from '@/components/layouts/app-layout'

/**
 * The signed-in shell's component: `AppLayout` inside the providers every
 * signed-in page needs. `StepUpProvider` owns the one "Confirm it's you"
 * dialog, so a write refused for a stale sign-in asks from any page.
 */
export function AppShell() {
  return (
    <StepUpProvider>
      <AppLayout />
    </StepUpProvider>
  )
}
