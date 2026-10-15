import { Spinner } from '@/components/ui/spinner'

/**
 * What a route shows while its loader runs. The router holds it back until
 * `defaultPendingMs` has passed, so a fast navigation never flashes it.
 */
export function RoutePending() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center px-4 py-16">
      <Spinner aria-hidden="true" className="size-6 text-muted-foreground" />
    </div>
  )
}
