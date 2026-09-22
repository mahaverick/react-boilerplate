import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROUTES } from '@/constants/routes'
import { flattenPages, unreadCount, useNotifications } from '@/queries/notification.queries'

const PREVIEW_COUNT = 5

export function NotificationBell() {
  const notifications = useNotifications()
  const recent = flattenPages(notifications.data).slice(0, PREVIEW_COUNT)
  // Counted from the pages already loaded, because this API has no
  // unread-count endpoint — see `unreadCount`'s own comment.
  const unread = unreadCount(notifications.data)

  return (
    <DropdownMenu>
      {/* Icon-only. Base UI's Tooltip emits neither role="tooltip" nor
          aria-describedby, so a tooltip would NOT name this control and the
          badge alone is not a name either — the count has to be IN the label,
          which is also what makes it available to a screen reader at all.
          The label sits on the rendered element because useRender lets that
          element's own props win over the trigger's. */}
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications, ${unread} unread`}
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
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          // Not a DropdownMenuItem: there is nothing here to activate, and a
          // focusable item that does nothing is worse than plain text.
          <p className="px-1.5 py-2 text-sm text-muted-foreground">You have no notifications.</p>
        ) : (
          recent.map((notification) => (
            // A real anchor, so the preview is keyboard-reachable and
            // openable in a new tab. Base UI's Menu.Item has no `onSelect`.
            <DropdownMenuItem key={notification.id} render={<Link to={ROUTES.notifications} />}>
              {/* aria-hidden: a screen reader would otherwise announce the
                  dot as "black circle". The unread state is spelled out in
                  the trigger's own label, and in full on the page. */}
              {notification.readAt === null && <span aria-hidden="true">&#9679;</span>}
              <span className="truncate">{notification.title}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to={ROUTES.notifications} />}>
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
