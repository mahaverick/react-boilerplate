import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import { useDeletePasskey, useRenamePasskey } from '@/queries/passkey-manage.queries'
import { passkeyKeys } from '@/queries/passkey.queries'
import { renamePasskeySchema } from '@/schemas/passkey.schemas'
import { LAST_PASSKEY, type PasskeyMode, type PublicPasskey } from '@/types/passkey.types'

const DELETE_BODY = 'After you delete it, this passkey no longer signs you in or confirms it’s you.'
const LAST_PASSKEY_WARNING =
  'This is your only passkey. You’ll sign in with an email link or Google until you create another.'
const LAST_PASSKEY_REFUSAL =
  'Create another passkey before you delete this one. Your account needs at least one.'

/**
 * The rename dialog for one passkey: a Name field (1 to 64 characters, trimmed)
 * and Save. A name the server refuses lands under the field. The form mounts
 * only while the dialog is open, so it always starts from the stored name.
 * @param props.passkey - The passkey being renamed.
 * @param props.open - Whether the dialog shows.
 * @param props.onOpenChange - Called when the dialog asks to open or close.
 */
export function RenamePasskeyDialog({
  passkey,
  open,
  onOpenChange,
}: {
  passkey: PublicPasskey
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename passkey</DialogTitle>
        </DialogHeader>
        <RenameForm passkey={passkey} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** The rename dialog's form. */
function RenameForm({ passkey, onDone }: { passkey: PublicPasskey; onDone: () => void }) {
  const rename = useRenamePasskey()
  const queryClient = useQueryClient()
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { name: passkey.name },
    validators: { onSubmit: renamePasskeySchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await rename.mutateAsync({ id: passkey.id, name: value.name })
        toast.success('Passkey renamed.')
        onDone()
      } catch (error) {
        // A 404: another tab deleted this passkey, so the list is stale.
        if (statusFrom(error) === 404) {
          void queryClient.invalidateQueries({ queryKey: passkeyKeys.list })
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors}>
      <FormField form={form} name="name">
        {(field) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                autoComplete="off"
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>1 to 64 characters.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormError />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <BusyButton type="submit" busy={rename.isPending} busyLabel="Saving…">
          Save
        </BusyButton>
      </DialogFooter>
    </Form>
  )
}

/**
 * The delete confirmation for one passkey.
 *
 * - With other passkeys it asks, then deletes through "Confirm it's you".
 * - On the only passkey in `optional` mode it also warns that sign-in falls back to email or Google.
 * - On the only passkey in `required` mode it refuses, with a Close button and no Delete.
 * - A 409 `LAST_PASSKEY` (another tab deleted the other one first) toasts the server's message and refetches the list.
 *
 * @param props.passkey - The passkey to delete.
 * @param props.mode - The passkey mode.
 * @param props.isOnly - Whether it is the account's only passkey.
 * @param props.open - Whether the dialog shows.
 * @param props.onOpenChange - Called when the dialog asks to open or close.
 */
export function DeletePasskeyDialog({
  passkey,
  mode,
  isOnly,
  open,
  onOpenChange,
}: {
  passkey: PublicPasskey
  mode: PasskeyMode
  isOnly: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const remove = useDeletePasskey()
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const refused = isOnly && mode === 'required'

  /** Runs the delete, then closes with the outcome in a toast. */
  const confirm = () => {
    stepUp
      .run(() => remove.mutateAsync(passkey.id))
      .then(
        () => {
          onOpenChange(false)
          toast.success('Passkey deleted.')
        },
        (error: unknown) => {
          onOpenChange(false)
          if (codeFrom(error) === LAST_PASSKEY || statusFrom(error) === 404) {
            void queryClient.invalidateQueries({ queryKey: passkeyKeys.list })
            toast.error(messageFrom(error))
            return
          }
          toast.error(isReauthRequired(error) ? stepUpRefusal(error) : messageFrom(error))
        }
      )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // While the delete waits on "Confirm it's you", Escape and outside presses belong to it.
        if (!next && stepping) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “<Pii>{passkey.name}</Pii>”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {refused ? LAST_PASSKEY_REFUSAL : DELETE_BODY}
          </AlertDialogDescription>
          {isOnly && !refused ? (
            <p className="text-sm text-muted-foreground">{LAST_PASSKEY_WARNING}</p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{refused ? 'Close' : 'Cancel'}</AlertDialogCancel>
          {refused ? null : (
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || stepping}
              onClick={confirm}
            >
              {stepping ? STEP_UP_WAITING_LABEL : remove.isPending ? 'Deleting…' : 'Delete passkey'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
