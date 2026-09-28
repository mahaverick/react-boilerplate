import { lazy, Suspense } from 'react'
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

/** The TanStack Query and Router devtools. Renders nothing outside development. */
export function Devtools() {
  if (!QueryDevtools || !RouterDevtools) return null
  return (
    <Suspense fallback={null}>
      <QueryDevtools buttonPosition="bottom-right" />
      <RouterDevtools router={router} position="bottom-left" />
    </Suspense>
  )
}
