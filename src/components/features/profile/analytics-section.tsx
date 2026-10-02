import { useId } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  getAnalyticsConfig,
  grantAnalyticsConsent,
  isAnalyticsAvailable,
  type AnalyticsConfig,
} from '@/observability/analytics'
import { useUpdateAnalyticsOptOut } from '@/queries/profile.queries'
import type { User } from '@/types/api.types'

/**
 * The profile's "Share usage analytics" switch. Off stops analytics in the
 * browser (the API's own events continue, by design); in `required` consent
 * mode, turning it on is also the consent the banner would ask for. Renders
 * nothing when analytics cannot run: no key, or consent mode `off`.
 */
export function AnalyticsSection({
  user,
  config = getAnalyticsConfig(),
}: {
  user: User
  /** Defaults to this page's run-time configuration. */
  config?: AnalyticsConfig
}) {
  const update = useUpdateAnalyticsOptOut()
  const headingId = useId()
  const labelId = useId()
  const descriptionId = useId()

  if (!isAnalyticsAvailable(config)) return null

  return (
    <section aria-labelledby={headingId} className="mt-6 grid gap-3 border-t pt-6">
      <h2 id={headingId} className="text-lg font-semibold">
        Privacy
      </h2>
      <div className="flex items-center justify-between gap-4">
        <span id={labelId} className="text-sm font-medium">
          Share usage analytics
        </span>
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={!user.analyticsOptOut}
          disabled={update.isPending}
          onCheckedChange={(isSharing: boolean) => {
            update.mutate(!isSharing, {
              onSuccess: () => {
                if (isSharing && config.consentMode === 'required') {
                  grantAnalyticsConsent()
                }
                toast.success(isSharing ? 'Usage analytics on.' : 'Usage analytics off.')
              },
              onError: (error) => toast.error(writeFailureMessage(error)),
            })
          }}
        />
      </div>
      <p id={descriptionId} className="text-sm text-muted-foreground">
        Which pages you visit and what you click, with names and addresses masked, so we can improve
        this app. Turning it off stops this in your browser; the actions you take are still recorded
        on our servers.
      </p>
    </section>
  )
}
