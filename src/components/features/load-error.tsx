import { Button } from '@/components/ui/button'

/**
 * The message every tenant tab shows when the role lookup fails. One
 * definition, because every tenant tab gates on the same query and a reader
 * moving between them should not get a different account of the same
 * failure.
 */
export const ROLE_ERROR =
  'We could not load your role in this tenant, so its controls are hidden until we can.'

/**
 * What a screen shows when something it needs could not be loaded: not a
 * skeleton, which would promise data that is not arriving. `role="alert"`
 * announces the failure, and the retry control puts the next move in reach.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="grid justify-items-start gap-3 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
