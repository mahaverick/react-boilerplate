import { Button } from '@/components/ui/button'

/**
 * The message the tenant tabs show when the role lookup they gate on fails.
 * One definition, so every tab words the same failure the same way.
 */
export const ROLE_ERROR =
  'We could not load your role in this tenant, so its controls are hidden until we can.'

/**
 * What a screen shows when something it needs could not be loaded: not a
 * skeleton, which would promise data that is not arriving. `role="alert"`
 * announces the failure, and the button calls `onRetry`.
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
