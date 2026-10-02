import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  denyAnalyticsConsent,
  getAnalyticsConfig,
  getAnalyticsConsent,
  grantAnalyticsConsent,
  subscribeAnalyticsConsent,
  type AnalyticsConsentMode,
} from '@/observability/analytics'

/**
 * The consent banner, shown only in `required` consent mode while this browser
 * has not answered. Until it is accepted nothing is captured; a decline leaves
 * cookieless, anonymous counts. It waits for posthog-js to load, since the
 * answer is stored by posthog-js itself.
 */
export function ConsentBanner({
  mode = getAnalyticsConfig().consentMode,
}: {
  /** Defaults to this page's run-time consent mode. */
  mode?: AnalyticsConsentMode
}) {
  const consent = useSyncExternalStore(
    subscribeAnalyticsConsent,
    getAnalyticsConsent,
    () => undefined
  )
  if (mode !== 'required' || consent !== 'pending') return null

  return (
    <section
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-between gap-3 border-t bg-background p-4 shadow-lg"
    >
      <p className="max-w-2xl text-sm">
        May we record how you use this app, with names and addresses masked, to improve it? If you
        decline, we only count visits, anonymously and without cookies.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={denyAnalyticsConsent}>
          Decline
        </Button>
        <Button onClick={grantAnalyticsConsent}>Accept</Button>
      </div>
    </section>
  )
}
