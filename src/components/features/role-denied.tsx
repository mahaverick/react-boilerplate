import { IconLock } from '@tabler/icons-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * What a section shows when the API refuses the caller's role (`isRoleDenied`):
 * the role changed after the page loaded. It does not sign out; reloading
 * re-runs the guards and the role gates. A destructive alert (`role="alert"`)
 * announces the refusal.
 */
export function RoleDenied() {
  return (
    <Alert variant="destructive">
      <IconLock aria-hidden="true" />
      <AlertTitle>Your role can’t see this any more.</AlertTitle>
      <AlertDescription>Reload the page to see what your current role allows.</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </AlertAction>
    </Alert>
  )
}
