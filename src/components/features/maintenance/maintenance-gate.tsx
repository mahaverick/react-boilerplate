import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { installMaintenanceRecovery, markMaintenanceViewed } from '@/lib/maintenance-mode'
import { track } from '@/observability/analytics'
import { useMaintenanceStatus } from '@/queries/maintenance-status.queries'
import { useMaintenanceMode } from '@/states/maintenance-mode.store'
import { MaintenancePage } from './maintenance-page'
import { ReadOnlyBanner } from './read-only-banner'

/**
 * Wraps every route. In `full` it renders the maintenance page instead of
 * `children`; in `read_only` it puts the banner above them. It reads the
 * status endpoint (`useMaintenanceStatus`) for as long as the app is open,
 * holds the recovery that runs when `full` ends (`installMaintenanceRecovery`,
 * bound to the router rendering it), and reads the status again whenever a
 * response header has switched the mode on without saying since when or why.
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

  useEffect(() => installMaintenanceRecovery(router, queryClient), [router, queryClient])

  useEffect(() => {
    if (mode !== 'off' && since === null) void refetch({ cancelRefetch: false })
  }, [mode, since, refetch])

  useEffect(() => {
    if (mode === 'off' || !since || !markMaintenanceViewed(since)) return
    track('maintenance_page_viewed', { mode })
  }, [mode, since])

  if (mode === 'full') return <MaintenancePage message={message} since={since} />

  return (
    <>
      {mode === 'read_only' && <ReadOnlyBanner message={message} />}
      {children}
    </>
  )
}
