import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router'
import { ConsentBanner } from '@/components/features/analytics/consent-banner'
import { Toaster } from '@/components/ui/sonner'
import { APP_NAME } from '@/constants/app'
import { bootstrapSession } from '@/router'

/**
 * The router context. Exported because `composite: true` (tsconfig.app.json)
 * emits declarations, which cannot name an unexported type (TS4023).
 */
export interface RouterContext {
  queryClient: QueryClient
}

/**
 * The root route. Its beforeLoad awaits the session restore before any child
 * guard runs; a useEffect would let `_app` and `_auth` see an empty store and
 * redirect wrongly on every reload.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    await bootstrapSession()
  },
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <HeadContent />
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
      <ConsentBanner />
    </>
  )
}
