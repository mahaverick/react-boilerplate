import { Button } from '@/components/ui/button'

/**
 * The message every tenant tab shows when the role lookup fails. One
 * definition, because all three tabs gate on the same query and a reader
 * moving between them should not get three different accounts of one
 * failure.
 */
export const ROLE_ERROR =
  'We could not load your role in this tenant, so its controls are hidden until we can.'

/**
 * What a screen shows when something it needs could not be loaded.
 *
 * Deliberately NOT a skeleton. A skeleton says "this is arriving", and a
 * request that has already failed is not arriving — a screen that keeps
 * showing one after an error looks like progress and never resolves, which
 * is worse than an error, because the reader has nothing to act on and no
 * reason to stop waiting.
 *
 * `role="alert"` so the failure is announced rather than only drawn, and a
 * retry control so the reader's next move is in front of them.
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
