import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { bootstrapSession } from '@/router'

// Exported, not local: tsconfig.app.json sets `composite: true`, which turns
// on declaration emit, and a declaration file cannot name a type it cannot
// import. Left unexported this is TS4023 on `Route`, on `router`, and on
// every route in routeTree.gen.ts.
export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Awaited BEFORE any child guard runs. A useEffect would let _app and
  // _auth observe an empty store and redirect wrongly on every reload.
  beforeLoad: async () => {
    await bootstrapSession()
  },
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}
