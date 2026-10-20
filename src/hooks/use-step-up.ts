import { createContext, useContext } from 'react'

/** Runs a request that may need a recent sign-in. */
export interface StepUp {
  /**
   * Run `action`. If it fails with REAUTH_REQUIRED, ask the user to confirm
   * who they are and run it ONCE more; if they dismiss the dialog, reject with
   * the original error. Any other failure rejects unchanged.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>
}

/** Provided by `StepUpProvider`, which `AppShell` mounts once around every signed-in page. */
export const StepUpContext = createContext<StepUp | null>(null)

/** The step-up runner. Throws outside `<StepUpProvider>`, where a destructive action has no dialog to ask with. */
export function useStepUp(): StepUp {
  const value = useContext(StepUpContext)
  if (!value) throw new Error('useStepUp must be used inside <StepUpProvider>')
  return value
}

/**
 * True while "Confirm it's you" waits on the user: from the refused request
 * until they confirm or dismiss. False outside `<StepUpProvider>`.
 */
export const StepUpWaitingContext = createContext(false)

/** Whether a step-up is waiting, so the action's own dialog can say what it waits on. */
export function useStepUpWaiting(): boolean {
  return useContext(StepUpWaitingContext)
}

/** The busy label of an action's button while its step-up waits. */
export const STEP_UP_WAITING_LABEL = 'Waiting for you to confirm…'
