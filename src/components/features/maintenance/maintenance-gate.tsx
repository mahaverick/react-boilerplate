import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { installMaintenanceRecovery, markMaintenanceViewed } from '@/lib/maintenance-mode'
import { track } from '@/observability/analytics'
import { maintenanceStatusKey, useMaintenanceStatus } from '@/queries/maintenance-status.queries'
import { useMaintenanceMode, useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { MaintenancePage } from './maintenance-page'
import { ReadOnlyBanner } from './read-only-banner'

/** The signed-in shell's route; its layout draws the read-only banner itself (`MaintenanceBanner`). */
export const APP_SHELL_ROUTE_ID = '/_app'

/**
 * The read-only banner while maintenance is `read_only`, nothing otherwise.
 * The signed-in shell renders it inside its content column, under the
 * header, so the fixed sidebar never covers it.
 */
export function MaintenanceBanner() {
  const { mode, message } = useMaintenanceMode()
  return mode === 'read_only' ? <ReadOnlyBanner message={message} /> : null
}

/**
 * Wraps every route. In `full` it renders the maintenance page instead of
 * `children`; in `read_only` it puts the banner above them, except under the signed-in shell,
 * whose layout places `MaintenanceBanner` itself. It reads the
 * status endpoint (`useMaintenanceStatus`) for as long as the app is open,
 * holds the recovery that runs when `full` ends (`installMaintenanceRecovery`,
 * bound to the router rendering it), and reads the status again whenever a
 * response header has switched the mode on without saying since when or why,
 * cancelling an older read still in flight so its answer cannot revert the mode;
 * a header that turns the mode off again cancels that read in turn.
 * It reports `maintenance_page_viewed` once per tab session for each
 * maintenance period, keyed on its `since`, through the analytics consent
 * rules like every other event. A period whose start is not known yet is
 * reported once the status endpoint supplies it.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { refetch } = useMaintenanceStatus()
  const { mode, message, since } = useMaintenanceMode()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isInAppShell = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === APP_SHELL_ROUTE_ID),
  })

  useEffect(() => installMaintenanceRecovery(router, queryClient), [router, queryClient])

  useEffect(() => {
    if (mode === 'off' || since !== null) return
    let isCancelled = false
    // `cancelRefetch` only cancels a read that has data already; the first read has none.
    void queryClient.cancelQueries({ queryKey: maintenanceStatusKey }).then(() => {
      // The mode changed again (back off, or its start became known) before the cancel finished.
      if (!isCancelled) void refetch({ cancelRefetch: true })
    })
    return () => {
      isCancelled = true
      // A read sent before a header turned the mode off would put the old mode back, through its answer and its own header.
      if (useMaintenanceModeStore.getState().mode === 'off') {
        void queryClient.cancelQueries({ queryKey: maintenanceStatusKey })
      }
    }
  }, [mode, since, refetch, queryClient])

  useEffect(() => {
    if (mode === 'off' || !since || !markMaintenanceViewed(since)) return
    track('maintenance_page_viewed', { mode })
  }, [mode, since])

  if (mode === 'full') return <MaintenancePage message={message} since={since} />

  return (
    <>
      {!isInAppShell && <MaintenanceBanner />}
      {children}
    </>
  )
}
