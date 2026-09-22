import { createFileRoute } from '@tanstack/react-router'
import { Check, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  flattenPages,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  usePreferences,
  type Notification,
  type NotificationPreference,
} from '@/queries/notification.queries'

export const Route = createFileRoute('/_app/notifications')({ component: NotificationsPage })

/** The notification's own timestamp, in the reader's locale. */
function receivedAt(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date
  )
}

/** `verify_email` -> `Verify email`, for a label a reader can parse. */
function humanize(type: string): string {
  const spaced = type.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkRead()
  const remove = useDeleteNotification()
  const isUnread = notification.readAt === null

  return (
    <li className={cn('flex items-start gap-3 rounded-md border p-3', isUnread && 'bg-muted/50')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{notification.title}</h3>
          {/* The badge is decoration on top of a name the row already has in
              text; it is never the only thing that says "unread". */}
          {isUnread && <Badge variant="secondary">Unread</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{notification.body}</p>
        <p className="text-xs text-muted-foreground">
          {humanize(notification.type)} &middot; {receivedAt(notification.createdAt)}
        </p>
      </div>
      {isUnread && (
        // Icon-only: Base UI's Tooltip emits no role="tooltip" and no
        // aria-describedby, so only this aria-label names the control — and it
        // names WHICH notification, since the page renders many of these.
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
 * One notification type's resolved channel state — READ-ONLY, deliberately.
 *
 * There are no switches here because there is nothing the server would
 * accept: `CONFIGURABLE_NOTIFICATION_TYPES` (notification.validators.ts) is
 * `NOTIFICATION_TYPES` minus the types whose email channel may never be
 * disabled, and today those two sets are identical — so the configurable list
 * is empty and every `PUT /notifications/preferences` answers 400. A control
 * that always fails reads as broken and teaches the wrong pattern, and the
 * client cannot infer which types ARE configurable because that list is
 * module-private on the server.
 *
 * `useUpdatePreferences` stays exported and tested for the day that changes;
 * turning this back into a control is then a change to this component alone.
 */
function PreferenceRow({ preference }: { preference: NotificationPreference }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="font-medium">{humanize(preference.notificationType)}</span>
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>Email: {preference.emailEnabled ? 'On' : 'Off'}</span>
        <span>In-app: {preference.inAppEnabled ? 'On' : 'Off'}</span>
      </div>
    </li>
  )
}

function PreferencesCard() {
  const preferences = usePreferences()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Preferences</h2>
        </CardTitle>
        <CardDescription>
          How each kind of notification currently reaches you. Notification preferences are not
          configurable yet — every type this account can receive is one that cannot be turned off.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preferences.isPending ? (
          <Skeleton className="h-14 w-full" />
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

function NotificationsPage() {
  const notifications = useNotifications()
  const markAllRead = useMarkAllRead()
  const rows = flattenPages(notifications.data)
  const hasUnread = rows.some((notification) => notification.readAt === null)

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          {/* CardTitle renders a div, so the page would otherwise have no
              heading at all — axe's `page-has-heading-one` is on by default. */}
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
