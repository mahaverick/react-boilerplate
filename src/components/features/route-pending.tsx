import { IconLoader2 } from '@tabler/icons-react'

/**
 * What a route shows while its loader runs. The router holds it back until
 * `defaultPendingMs` has passed, so a fast navigation never flashes it.
 */
export function RoutePending() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center px-4 py-16">
      <IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  )
}
