import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROUTES } from '@/constants/routes'
import { flattenPages, unreadCount, useNotifications } from '@/queries/notification.queries'

const PREVIEW_COUNT = 5

/**
 * The header's notification menu: an unread count and the latest few.
 *
 * The count comes from the loaded pages (the API has no unread-count
 * endpoint) and is unknown, not zero, until data exists. It lives in the
 * trigger's label, because Base UI's Tooltip emits neither role="tooltip" nor
 * aria-describedby and the badge is not a name; the label says "count
 * unavailable" rather than "0 unread" when nothing has loaded. The label sits
 * on the rendered element, whose own props win under useRender.
 *
 * The `DropdownMenuGroup` is required: `DropdownMenuLabel` is Base UI's
 * `Menu.GroupLabel`, which throws outside a `Menu.Group`. The group also
 * names the preview items; "View all notifications" sits outside it.
 *
 * Loaded rows win over an error here, unlike the notifications page: a
 * dropdown with usable cached rows stays usable, and the page reports the
 * failure. With no rows it says whether the list failed, is loading, or is
 * empty, as plain text rather than an alert region or a do-nothing item.
 * Each preview is a real anchor (Base UI's Menu.Item has no `onSelect`), and
 * its unread dot is aria-hidden, since the label spells out the count.
 */
export function NotificationBell() {
  const notifications = useNotifications()
  const recent = flattenPages(notifications.data).slice(0, PREVIEW_COUNT)
  const unread = unreadCount(notifications.data)
  const isCountKnown = notifications.data !== undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              isCountKnown ? `Notifications, ${unread} unread` : 'Notifications, count unavailable'
            }
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <Badge
            variant="destructive"
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-4 px-1"
          >
            {unread}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {recent.length > 0 ? (
            recent.map((notification) => (
              <DropdownMenuItem key={notification.id} render={<Link to={ROUTES.notifications} />}>
                {notification.readAt === null && <span aria-hidden="true">&#9679;</span>}
                <span className="truncate">{notification.title}</span>
              </DropdownMenuItem>
            ))
          ) : notifications.isError ? (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">
              Notifications could not be loaded.
            </p>
          ) : notifications.isPending ? (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">Loading notifications…</p>
          ) : (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">You have no notifications.</p>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to={ROUTES.notifications} />}>
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
