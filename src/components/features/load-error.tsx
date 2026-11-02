import { IconAlertCircle } from '@tabler/icons-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * What a screen shows when something it needs could not be loaded: not a
 * skeleton, which would promise data that is not arriving. A destructive alert
 * (`role="alert"`) announces the failure, and the button calls `onRetry`.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="has-data-[slot=alert-action]:pr-28">
      <IconAlertCircle aria-hidden="true" />
      <AlertTitle>Not loaded</AlertTitle>
      <AlertDescription className="min-w-0 wrap-anywhere">{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}
