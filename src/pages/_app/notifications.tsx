import { IconBell, IconCheck, IconTrash } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import { humanizeNotificationType } from '@/lib/notification-type'
import { cn } from '@/lib/utils'
import { notificationsList } from '@/queries/notification-list.queries'
import {
  notificationsListOptions,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useUnreadCount,
  type Notification,
} from '@/queries/notification.queries'

/** The notification inbox; delivery preferences live in Settings. */
export const Route = createFileRoute('/_app/notifications')({
  validateSearch: notificationsList.schema,
  staticData: { crumb: 'Notifications' },
  head: () => ({ meta: [{ title: pageTitle('Notifications') }] }),
  component: NotificationsPage,
})

/** What the inbox says when its query failed, as opposed to came back empty. */
const NOTIFICATIONS_ERROR =
  'We could not load your notifications, so none are listed here. This is not a sign that you have none.'

const column = createColumnHelper<DataTableFeatures, Notification>()

/** The inbox's fields; the cards are `NotificationRow`, so these only name them. */
const columns = column.columns([
  column.accessor('title', { header: 'Title' }),
  column.accessor('type', { header: 'Type' }),
  column.accessor('createdAt', { header: 'Received' }),
])

/** The read-state facet: unread or read, one at a time. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'unread',
    label: 'Status',
    options: [
      { value: 'true', label: 'Unread' },
      { value: 'false', label: 'Read' },
    ],
    single: true,
  },
]

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
        <ItemTitle className="line-clamp-none">
          <div className="flex flex-wrap items-center gap-2">
            <h2>{notification.title}</h2>
            {isUnread && <Badge variant="secondary">Unread</Badge>}
          </div>
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
 * The inbox: every notification as a card, a page at a time, with a search box
 * and a read-state filter. The list's loading, error and empty states are
 * `DataTable`'s, so a failed load is never the empty inbox. "Mark all read"
 * shows while the API's unread total is above zero.
 */
function NotificationsPage() {
  const list = useListSearch(notificationsList)
  const notifications = useListQuery(list, notificationsListOptions)
  const unread = useUnreadCount().data
  const markAllRead = useMarkAllRead()

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
          {unread !== undefined && unread.count > 0 && (
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
          <DataTable
            columns={columns}
            query={notifications}
            label="Notifications"
            errorMessage={NOTIFICATIONS_ERROR}
            layout="cards"
            getRowId={(notification) => notification.id}
            card={(notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            )}
            search={{ label: 'Search notifications', placeholder: 'Search by title or text' }}
            filters={FILTERS}
            empty={
              <EmptyState
                icon={<IconBell aria-hidden="true" />}
                title="You have no notifications."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
