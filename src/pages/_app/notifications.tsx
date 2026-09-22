import { createFileRoute } from '@tanstack/react-router'
import { Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { messageFrom } from '@/lib/api-error'
import { cn } from '@/lib/utils'
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

function PreferenceRow({ preference }: { preference: NotificationPreference }) {
  const update = useUpdatePreferences()
  const label = humanize(preference.notificationType)

  // Both channel booleans travel on every write: the server's schema requires
  // a whole entry, so flipping one switch sends the other's current value too.
  const toggle = (channel: 'emailEnabled' | 'inAppEnabled', checked: boolean) => {
    update.mutate(
      { ...preference, [channel]: checked },
      { onError: (error) => toast.error(messageFrom(error)) }
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-6">
        {/* The visible text sits in a wrapping label, but the matrix renders
            one of these rows PER TYPE — so without an aria-label a screen
            reader hears several switches all called "Email". */}
        <label className="flex items-center gap-2 text-sm">
          <span>Email</span>
          <Switch
            checked={preference.emailEnabled}
            disabled={update.isPending}
            aria-label={`${label}: email`}
            onCheckedChange={(checked) => toggle('emailEnabled', checked)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span>In-app</span>
          <Switch
            checked={preference.inAppEnabled}
            disabled={update.isPending}
            aria-label={`${label}: in-app`}
            onCheckedChange={(checked) => toggle('inAppEnabled', checked)}
          />
        </label>
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
          Choose how each kind of notification reaches you. Some types cannot be turned off — the
          server says which, and will explain if a change is refused.
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
            There is nothing to configure for this account yet.
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
