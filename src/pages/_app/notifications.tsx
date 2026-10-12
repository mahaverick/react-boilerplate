import { createFileRoute } from '@tanstack/react-router'
import { Check, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { pageTitle } from '@/constants/app'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { writeFailureMessage } from '@/lib/write-failure'
import {
  flattenPages,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  usePreferences,
  useUpdatePreferences,
  type Notification,
  type NotificationPreference,
} from '@/queries/notification.queries'

/** The notification inbox and the delivery preferences. */
export const Route = createFileRoute('/_app/notifications')({
  head: () => ({ meta: [{ title: pageTitle('Notifications') }] }),
  staticData: { crumb: 'Notifications' },
  component: NotificationsPage,
})

/**
 * What each card says when its query failed, as opposed to came back empty.
 * Two messages, because the inbox and the preference matrix are separate
 * requests and either can fail alone.
 */
const NOTIFICATIONS_ERROR =
  'We could not load your notifications, so none are listed here. This is not a sign that you have none.'
const PREFERENCES_ERROR = 'We could not load your notification preferences, so none are shown here.'

/** The notification's own timestamp, in the reader's locale. */
function receivedAt(createdAt: string): string {
  return formatDateTime(createdAt) ?? 'Unknown'
}

/** `verify_email` -> `Verify email`, for a label a reader can parse. */
function humanize(type: string): string {
  const spaced = type.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * One notification. The Unread badge puts the state in text, so it is not
 * carried by the row's tint alone. The icon-only buttons are named by their
 * aria-labels (Base UI's Tooltip emits no role="tooltip" or aria-describedby),
 * which include the notification's title, since the page renders many.
 */
function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkRead()
  const remove = useDeleteNotification()
  const isUnread = notification.readAt === null

  return (
    <li className={cn('flex items-start gap-3 rounded-md border p-3', isUnread && 'bg-muted/50')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{notification.title}</h3>
          {isUnread && <Badge variant="secondary">Unread</Badge>}
        </div>
        <Pii as="p" className="text-sm text-muted-foreground">
          {notification.body}
        </Pii>
        <p className="text-xs text-muted-foreground">
          {humanize(notification.type)} &middot; {receivedAt(notification.createdAt)}
        </p>
      </div>
      {isUnread && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Mark "${notification.title}" as read`}
          disabled={markRead.isPending}
          onClick={() => markRead.mutate(notification.id)}
        >
          <Check className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete "${notification.title}"`}
        disabled={remove.isPending}
        onClick={() => remove.mutate(notification.id)}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  )
}

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
  const label = humanize(preference.notificationType)
  const inAppEnabled = update.isPending ? update.variables.inAppEnabled : preference.inAppEnabled

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>Email: On</span>
        <div className="flex items-center gap-2">
          <span id={labelId}>
            <span className="sr-only">{label}: </span>In-app
          </span>
          <Switch
            aria-labelledby={labelId}
            checked={inAppEnabled}
            disabled={update.isPending}
            onCheckedChange={(next: boolean) =>
              update.mutate(
                {
                  notificationType: preference.notificationType,
                  emailEnabled: true,
                  inAppEnabled: next,
                },
                { onError: (error) => toast.error(writeFailureMessage(error)) }
              )
            }
          />
        </div>
      </div>
    </li>
  )
}

/** The preference matrix, with its own load, error and empty states. */
function PreferencesCard() {
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
          <p className="text-sm text-muted-foreground">
            This account has no notification types yet.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The inbox and the preferences. The inbox's error branch comes
 * before its empty state: `rows` is `[]` for a failed load and an empty inbox
 * alike.
 */
function NotificationsPage() {
  const notifications = useNotifications()
  const markAllRead = useMarkAllRead()
  const rows = flattenPages(notifications.data)
  const hasUnread = rows.some((notification) => notification.readAt === null)

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Notifications</h1>
          </CardTitle>
          <CardDescription>Everything this account has been sent, newest first.</CardDescription>
          {hasUnread && (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                Mark all read
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {notifications.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notifications.isError ? (
            <LoadError message={NOTIFICATIONS_ERROR} onRetry={() => void notifications.refetch()} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no notifications.</p>
          ) : (
            <ul className="grid gap-2">
              {rows.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} />
              ))}
            </ul>
          )}
          {notifications.hasNextPage && (
            <div>
              <Button
                variant="outline"
                disabled={notifications.isFetchingNextPage}
                onClick={() => void notifications.fetchNextPage()}
              >
                {notifications.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <PreferencesCard />
    </div>
  )
}
