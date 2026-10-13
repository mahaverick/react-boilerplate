import { IconBell, IconSettings } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { unreadCount, useNotifications } from '@/queries/notification.queries'

/**
 * The sidebar's bottom group: the notifications inbox, with the bell's unread
 * count, and Settings. Every link closes the mobile drawer.
 *
 * The count is said inside the Notifications link ("Notifications, 2 unread"),
 * so it is part of the name a screen reader announces on the link; the visible
 * badge sits outside the link, so it is hidden from assistive tech.
 */
export function NavSecondary({ pathname, className }: { pathname: string; className?: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const unread = unreadCount(useNotifications().data)
  /** Closes the drawer after a tap on a phone. */
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  return (
    <nav aria-label="Secondary" className={cn(className)}>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Notifications"
              isActive={pathname === ROUTES.notifications}
              render={<Link to={ROUTES.notifications} onClick={close} />}
            >
              <IconBell aria-hidden="true" />
              <span>Notifications</span>
              {unread > 0 && <span className="sr-only">, {unread} unread</span>}
            </SidebarMenuButton>
            {unread > 0 && <SidebarMenuBadge aria-hidden="true">{unread}</SidebarMenuBadge>}
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              render={<Link to={ROUTES.settings} onClick={close} />}
            >
              <IconSettings aria-hidden="true" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  )
}
