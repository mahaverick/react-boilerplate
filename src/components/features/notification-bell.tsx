import { IconBell } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmptyState } from '@/components/shared/empty-state'
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
import {
  BELL_PREVIEW_LIMIT,
  notificationsListOptions,
  useUnreadCount,
} from '@/queries/notification.queries'

/**
 * The header's notification menu: an unread count and the latest few.
 *
 * The count is the API's capped total of the unread view (a second read, one
 * row at a time), shown as "1,000+" at the cap, and is unknown, not zero,
 * until that read lands. It lives in the
 * trigger's label, because Base UI's Tooltip emits neither role="tooltip" nor
 * aria-describedby and the badge is aria-hidden, so neither would carry it;
 * the label says "count unavailable" rather than "0 unread" when the count has
 * not loaded. The label sits on the rendered element, whose own props win under
 * useRender.
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
 *
 * A failed unread read (or an answer with no total) marks the bell with a muted dot (hidden from
 * assistive tech; the label already says the count is unavailable). A failed
 * preview read offers Try again in the menu, which reads a failed count again
 * too; a failed count alone gets its own Try again under the rows.
 */
export function NotificationBell() {
  const preview = useQuery(
    notificationsListOptions({ limit: BELL_PREVIEW_LIMIT }, { total: false })
  )
  const recent = preview.data?.items ?? []
  const unreadQuery = useUnreadCount()
  const unread = unreadQuery.data
  // A count answer without a total is as unknown as a failed one: neither is "0 unread".
  const countFailed = unread === undefined && (unreadQuery.isError || unreadQuery.isSuccess)
  const countText = unread && `${unread.count.toLocaleString('en-US')}${unread.capped ? '+' : ''}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              countText === undefined
                ? 'Notifications, count unavailable'
                : `Notifications, ${countText} unread`
            }
          />
        }
      >
        <IconBell aria-hidden="true" className="size-4" />
        {unread !== undefined && unread.count > 0 && (
          <Badge
            variant="destructive"
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-4 px-1"
          >
            {countText}
          </Badge>
        )}
        {countFailed && (
          <span
            aria-hidden="true"
            data-slot="bell-unavailable"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-muted-foreground"
          />
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
          ) : preview.isError ? (
            <>
              <p className="p-2 text-center text-sm text-muted-foreground">
                Notifications could not be loaded.
              </p>
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => {
                  void preview.refetch()
                  if (countFailed) void unreadQuery.refetch()
                }}
              >
                Try again
              </DropdownMenuItem>
            </>
          ) : preview.isPending ? (
            <p className="p-2 text-center text-sm text-muted-foreground">Loading notifications…</p>
          ) : (
            <EmptyState size="compact" title="You have no notifications." className="p-2" />
          )}
          {countFailed && !preview.isError && (
            <DropdownMenuItem closeOnClick={false} onClick={() => void unreadQuery.refetch()}>
              Try again
            </DropdownMenuItem>
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
