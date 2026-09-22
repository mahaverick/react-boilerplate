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

export function NotificationBell() {
  const notifications = useNotifications()
  const recent = flattenPages(notifications.data).slice(0, PREVIEW_COUNT)
  // Counted from the pages already loaded, because this API has no
  // unread-count endpoint — see `unreadCount`'s own comment.
  const unread = unreadCount(notifications.data)
  // `data === undefined` is the one predicate that covers BOTH states in which
  // the count is not merely zero but UNKNOWN — never loaded, and failed to
  // load — while leaving a stale-but-known cache counted.
  const isCountKnown = notifications.data !== undefined

  return (
    <DropdownMenu>
      {/* Icon-only. Base UI's Tooltip emits neither role="tooltip" nor
          aria-describedby, so a tooltip would NOT name this control and the
          badge alone is not a name either — the count has to be IN the label,
          which is also what makes it available to a screen reader at all.
          The label sits on the rendered element because useRender lets that
          element's own props win over the trigger's.

          It does NOT say "0 unread" when the count is unknown. A failed or
          not-yet-answered load leaves `unread` at 0 exactly as a read inbox
          does, and announcing that figure states as fact something no request
          established — the same lie the menu below used to tell in text. */}
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
        {/* THE GROUP IS LOAD-BEARING, not decoration. `DropdownMenuLabel` is
            Base UI's `Menu.GroupLabel`, which READS `MenuGroupContext` and
            THROWS "MenuGroupContext is missing" when it is rendered outside a
            `Menu.Group` — so this menu did not merely look wrong without it,
            it took down the whole page through the root error boundary the
            moment the bell was clicked, on every route. Nothing caught it
            because no test had ever opened this menu; the suite only asserted
            the trigger's label. Measured at 1cbce00 before this line existed:
            clicking the bell rendered "Something went wrong!" in place of the
            app.

            It also earns its keep semantically — the group is what gives the
            preview items an accessible name ("Notifications") — and it stops
            at the preview: "View all notifications" is a separate action, not
            one of the listed notifications. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* A LOADED PREVIEW WINS OVER AN ERROR here, which is the opposite of
            the choice `pages/_app/notifications.tsx` makes on the same query —
            deliberately, and the same split the tenant switcher already has
            against the tenant list. A dropdown whose cached rows are still
            usable should stay usable; a PAGE whose whole job is the inbox
            should say the refresh failed rather than quietly show what it had.
            The bell is not the inbox, and "View all notifications" is one
            click from the surface that reports it properly. */}
          {recent.length > 0 ? (
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
          ) : notifications.isError ? (
            // The FIFTH instance of the false-empty-state defect, and the one
            // that reached every page: this bell sits in the app shell, driven
            // by the SAME query the inbox page guards — so a 500 had the page
            // render its error while the bell beside it asserted, in the same
            // layout, that the inbox was empty.
            //
            // Not a `LoadError` with a nested retry: a menu is no place for an
            // alert region, and "View all notifications" below already leads to
            // the page that DOES offer one. Stating the failure is the whole
            // requirement. (The switcher's error item reads the same way and for
            // the same reasons.)
            <p className="px-1.5 py-2 text-sm text-muted-foreground">
              Notifications could not be loaded.
            </p>
          ) : notifications.isPending ? (
            // Three states, not two. Without this, a menu opened mid-flight
            // reported an empty inbox on the strength of a request that had not
            // answered yet — the same claim as the error case, made a moment
            // earlier.
            <p className="px-1.5 py-2 text-sm text-muted-foreground">Loading notifications…</p>
          ) : (
            // Not a DropdownMenuItem: there is nothing here to activate, and a
            // focusable item that does nothing is worse than plain text.
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
