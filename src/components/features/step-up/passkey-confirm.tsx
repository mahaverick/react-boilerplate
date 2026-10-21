import { IconAlertCircle } from '@tabler/icons-react'
import type { ReactNode, Ref } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter } from '@/components/ui/dialog'

/** Why the dialog asks, when a passkey confirms. */
const CONFIRM_PASSKEY_LEAD =
  'This action needs a confirmation from the last 10 minutes. Use your passkey to confirm it’s you.'

/**
 * The passkey view of "Confirm it's you": the browser's passkey prompt is
 * open or was dismissed. Use your passkey asks again; Use another method, last
 * in the view, leaves for the emailed link.
 */
export function PasskeyConfirm({
  notice,
  busy,
  buttonRef,
  cancel,
  onUsePasskey,
  onOtherMethod,
}: {
  /** A failure to show above the buttons, or null. */
  notice: string | null
  /** Whether the options, the prompt or the verification is running. */
  busy: boolean
  /** Use your passkey's ref: the dialog's initial focus. */
  buttonRef: Ref<HTMLButtonElement>
  /** The dialog's Cancel button. */
  cancel: ReactNode
  onUsePasskey: () => void
  onOtherMethod: () => void
}) {
  return (
    <div className="grid gap-4">
      <DialogDescription>{CONFIRM_PASSKEY_LEAD}</DialogDescription>
      {notice !== null && (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden="true" />
          <AlertTitle>{notice}</AlertTitle>
        </Alert>
      )}
      <DialogFooter>
        {cancel}
        <BusyButton
          ref={buttonRef}
          busy={busy}
          busyLabel="Waiting for your passkey…"
          focusableWhenDisabled
          onClick={onUsePasskey}
        >
          Use your passkey
        </BusyButton>
      </DialogFooter>
      <Button type="button" variant="link" className="justify-self-center" onClick={onOtherMethod}>
        Use another method
      </Button>
    </div>
  )
}
