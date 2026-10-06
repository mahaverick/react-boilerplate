import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router'
import { ConsentBanner } from '@/components/features/analytics/consent-banner'
import { MaintenanceGate } from '@/components/features/maintenance/maintenance-gate'
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

/**
 * The page, inside the maintenance gate, which swaps it for the maintenance
 * screen while the mode is `full`. The gate is imported statically, as the
 * router's error screen is: it is needed exactly when the API is not
 * answering normally, which is a bad moment to fetch a lazy chunk.
 */
function RootComponent() {
  return (
    <>
      <HeadContent />
      <MaintenanceGate>
        <Outlet />
      </MaintenanceGate>
      <Toaster position="top-right" richColors closeButton />
      <ConsentBanner />
    </>
  )
}
