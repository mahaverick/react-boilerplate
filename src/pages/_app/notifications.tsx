import { IconBell, IconCheck, IconTrash } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { BusyButton } from '@/components/shared/busy-button'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
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
    <Item
      variant="outline"
      size="sm"
      role="listitem"
      className={cn('items-start', isUnread && 'bg-muted/50')}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none flex-wrap">
          <h3>{notification.title}</h3>
          {isUnread && <Badge variant="secondary">Unread</Badge>}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          <Pii>{notification.body}</Pii>
        </ItemDescription>
        <ItemDescription className="line-clamp-none text-xs">
          {humanizeNotificationType(notification.type)} &middot;{' '}
          {receivedAt(notification.createdAt)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
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
      </ItemActions>
    </Item>
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
            <EmptyState icon={<IconBell aria-hidden="true" />} title="You have no notifications." />
          ) : (
            <ItemGroup className="gap-2 has-data-[size=sm]:gap-2">
              {rows.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} />
              ))}
            </ItemGroup>
          )}
          {notifications.hasNextPage && (
            <div>
              <BusyButton
                busy={notifications.isFetchingNextPage}
                busyLabel="Loading…"
                variant="outline"
                onClick={() => void notifications.fetchNextPage()}
              >
                Load more
              </BusyButton>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
