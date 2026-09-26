import { lazy, Suspense } from 'react'
import { router } from '@/router'

// Guarded at module scope, not only inside the component: a production build
// replaces `import.meta.env.DEV` with `false`, which drops both dynamic
// imports, so neither package reaches a production chunk.
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
