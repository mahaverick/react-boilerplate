import { useId } from 'react'
import { LoadError } from '@/components/features/load-error'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { humanizeNotificationType } from '@/lib/notification-type'
import { toast } from '@/lib/toast'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  usePreferences,
  useUpdatePreferences,
  type NotificationPreference,
} from '@/queries/notification.queries'

/** What the card says when the preferences query failed, as opposed to came back empty. */
const PREFERENCES_ERROR = 'We could not load your notification preferences, so none are shown here.'

/**
 * One notification type's channels. Email is read-only text: the API refuses to
 * store a disabled email channel (`emailEnabled: false` is a 400), so it is
 * always "On". The in-app copy is a switch; each flip PUTs the whole entry with
 * `emailEnabled: true`. While the request is pending the switch is disabled and
 * shows the requested state; on failure it falls back to the stored value and a
 * toast carries the API's message. The matrix is refetched when the request
 * settles, so the row always ends on what the server holds.
 */
function PreferenceRow({ preference }: { preference: NotificationPreference }) {
  const update = useUpdatePreferences()
  const labelId = useId()
  const label = humanizeNotificationType(preference.notificationType)
  const inAppEnabled = update.isPending ? update.variables.inAppEnabled : preference.inAppEnabled

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        {/* Read-only: NON_DISABLEABLE_NOTIFICATION_TYPES (API) covers every type, */}
        {/* so email is always on and this reads "On". */}
        <span>Email: {preference.emailEnabled ? 'On' : 'Off'}</span>
        <div className="flex items-center gap-2">
          <span id={labelId}>
            <span className="sr-only">{label}: </span>In-app
          </span>
          <Switch
            aria-labelledby={labelId}
            checked={inAppEnabled}
            disabled={update.isPending}
            onCheckedChange={(next: boolean) => {
              if (update.isPending) return
              update.mutate(
                {
                  notificationType: preference.notificationType,
                  emailEnabled: true,
                  inAppEnabled: next,
                },
                { onError: (error) => toast.error(writeFailureMessage(error)) }
              )
            }}
          />
        </div>
      </div>
    </li>
  )
}

/** The preference matrix, with its own load, error and empty states. */
export function PreferencesCard() {
  const preferences = usePreferences()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Preferences</h2>
        </CardTitle>
        <CardDescription>
          How each kind of notification reaches you. Email for these notifications cannot be turned
          off, but you can turn off the in-app copy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preferences.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : preferences.isError ? (
          <LoadError message={PREFERENCES_ERROR} onRetry={() => void preferences.refetch()} />
        ) : preferences.data && preferences.data.length > 0 ? (
          <ul className="grid gap-2">
            {preferences.data.map((preference) => (
              <PreferenceRow key={preference.notificationType} preference={preference} />
            ))}
          </ul>
        ) : (
          <EmptyState size="compact" title="This account has no notification types yet." />
        )}
      </CardContent>
    </Card>
  )
}
