import { useCallback, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { StepUpContext, StepUpWaitingContext, type StepUp } from '@/hooks/use-step-up'
import { isReauthRequired, markRefusedAfterConfirm, sentWithCurrentToken } from '@/lib/step-up'

/** The dialog's props. */
type DialogProps = { open: boolean; onConfirmed: () => void; onDismissed: () => void }

/** The one in-flight or settled load of the dialog chunk. */
let loading: Promise<ComponentType<DialogProps>> | null = null

/**
 * Loads the dialog chunk. It loads on the first refusal, never with the
 * shell: a person who is never asked to confirm does not download it. A
 * failed load (the chunk is gone after a deploy) rejects, and the next call
 * tries again.
 * @returns The dialog component.
 */
function loadDialog(): Promise<ComponentType<DialogProps>> {
  loading ??= import('@/components/features/step-up/step-up-dialog').then(
    (module) => module.StepUpDialog,
    (error: unknown) => {
      loading = null
      throw error
    }
  )
  return loading
}

/** An action refused for a stale sign-in: `resolve` retries it after a confirmation, `reject` surfaces its refusal after a dismissal. */
interface Waiter {
  resolve: () => void
  reject: () => void
}

/**
 * Owns the one "Confirm it's you" dialog. Every request refused with
 * REAUTH_REQUIRED while it is open waits on the same confirmation, so two
 * refused actions never stack two dialogs, and one confirmation retries both.
 * `useStepUpWaiting()` reads true for as long as the dialog is open, so the
 * action's own dialog can say what it waits on.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // Once loaded, the dialog stays mounted, so it can play its closing animation.
  const [Dialog, setDialog] = useState<ComponentType<DialogProps> | null>(null)
  const waiters = useRef<Waiter[]>([])

  const finish = useCallback((confirmed: boolean) => {
    const waiting = waiters.current
    waiters.current = []
    setOpen(false)
    for (const waiter of waiting) {
      if (confirmed) waiter.resolve()
      else waiter.reject()
    }
  }, [])

  const confirm = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject })
        setOpen(true)
        // A chunk that fails to load rejects every waiter, so no button stays disabled.
        loadDialog().then(
          (component) => setDialog(() => component),
          () => finish(false)
        )
      }),
    [finish]
  )

  const value = useMemo<StepUp>(
    () => ({
      run: async <T,>(action: () => Promise<T>): Promise<T> => {
        try {
          return await action()
        } catch (error) {
          if (!isReauthRequired(error)) throw error
          // Refused with an older token than the store holds: another confirmation already landed.
          if (!sentWithCurrentToken(error)) return action()
          try {
            await confirm()
          } catch {
            throw error
          }
          // Once: a second REAUTH_REQUIRED rejects rather than reopening the dialog.
          try {
            return await action()
          } catch (retryError) {
            if (isReauthRequired(retryError)) markRefusedAfterConfirm(retryError)
            throw retryError
          }
        }
      },
    }),
    [confirm]
  )

  return (
    <StepUpContext value={value}>
      <StepUpWaitingContext value={open}>{children}</StepUpWaitingContext>
      {Dialog && (
        <Dialog open={open} onConfirmed={() => finish(true)} onDismissed={() => finish(false)} />
      )}
    </StepUpContext>
  )
}
