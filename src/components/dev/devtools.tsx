import { lazy, Suspense } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { router } from '@/router'

/** Guarded at module scope, so a production build drops both dynamic imports and neither package ships. */
const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools }))
    )
  : null
const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((m) => ({
        default: m.TanStackRouterDevtools,
      }))
    )
  : null

/** The TanStack Query and Router devtools. Renders nothing outside development or below `md`. */
export function Devtools() {
  const isMobile = useIsMobile()
  // Below `md` the sidebar is a full-height drawer whose account menu sits under the toggles.
  if (!QueryDevtools || !RouterDevtools || isMobile) return null
  return (
    <Suspense fallback={null}>
      <QueryDevtools buttonPosition="bottom-right" />
      {/* Bottom-right beside the Query button: bottom-left sat on the sidebar's account menu. */}
      <RouterDevtools
        router={router}
        position="bottom-right"
        toggleButtonProps={{ style: { right: '4.5rem' } }}
      />
    </Suspense>
  )
}
