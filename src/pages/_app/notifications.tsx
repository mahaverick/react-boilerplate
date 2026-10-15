import { IconCheck, IconTrash } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import { humanizeNotificationType } from '@/lib/notification-type'
import { cn } from '@/lib/utils'
import {
  flattenPages,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  type Notification,
} from '@/queries/notification.queries'

/** The notification inbox; delivery preferences live in Settings. */
export const Route = createFileRoute('/_app/notifications')({
  head: () => ({ meta: [{ title: pageTitle('Notifications') }] }),
  staticData: { crumb: 'Notifications' },
  component: NotificationsPage,
})

/** What the inbox says when its query failed, as opposed to came back empty. */
const NOTIFICATIONS_ERROR =
  'We could not load your notifications, so none are listed here. This is not a sign that you have none.'

/** The notification's own timestamp, in the reader's locale. */
function receivedAt(createdAt: string): string {
  return formatDateTime(createdAt) ?? 'Unknown'
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
          {humanizeNotificationType(notification.type)} &middot;{' '}
          {receivedAt(notification.createdAt)}
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
          <IconCheck aria-hidden="true" className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete "${notification.title}"`}
        disabled={remove.isPending}
        onClick={() => remove.mutate(notification.id)}
      >
        <IconTrash aria-hidden="true" className="size-4" />
      </Button>
    </li>
  )
}

/**
 * The inbox. Its error branch comes
 * before its empty state: `rows` is `[]` for a failed load and an empty inbox
 * alike.
 */
function NotificationsPage() {
  const notifications = useNotifications()
  const markAllRead = useMarkAllRead()
  const rows = flattenPages(notifications.data)
  const hasUnread = rows.some((notification) => notification.readAt === null)

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Notifications</h1>
          </CardTitle>
          <CardDescription>
            Everything this account has been sent, newest first.{' '}
            <Link to={ROUTES.settingsNotifications} className="underline underline-offset-4">
              Notification settings
            </Link>
          </CardDescription>
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
    </div>
  )
}
