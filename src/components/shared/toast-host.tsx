import { lazy, Suspense, type ComponentType } from 'react'
import { noteError } from '@/observability/errors'

/**
 * The toast UI, a chunk of its own fetched when the root route first renders,
 * so it stays out of first-visit JS. A toast raised before the chunk arrives
 * waits in `@/lib/toast`'s queue. If the chunk fails to load (a deploy removed
 * it), the failure is reported as an unhandled `chunk_load` error and toasts
 * stop showing, but the page keeps working: a rejected import would otherwise
 * throw into the router's `defaultErrorComponent` and replace the page.
 */
const Toaster = lazy(() =>
  import('@/components/ui/toast').then(
    (m): { default: ComponentType } => ({ default: m.Toaster }),
    (error: unknown): { default: ComponentType } => {
      noteError(error, 'chunk_load', false)
      return { default: () => null }
    }
  )
)

/** Mounts the app's toast host, lazily. `__root.tsx` renders it once. */
export function ToastHost() {
  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  )
}
