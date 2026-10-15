import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** A button's props plus whether its action is running and what it says meanwhile. */
type BusyButtonProps = ComponentProps<typeof Button> & {
  busy: boolean
  /** e.g. "Saving…"; the button's whole accessible name while busy. */
  busyLabel: ReactNode
}

/**
 * A button whose action takes a while: while `busy` it is disabled, marked
 * `aria-busy`, and shows a spinner (hidden from assistive tech) before
 * `busyLabel`.
 */
export function BusyButton({ busy, busyLabel, children, disabled, ...props }: BusyButtonProps) {
  return (
    <Button {...props} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <Spinner aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
