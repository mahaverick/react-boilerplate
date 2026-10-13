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
            </SidebarMenuButton>
            {unread > 0 && (
              <SidebarMenuBadge>
                {unread}
                <span className="sr-only"> unread</span>
              </SidebarMenuBadge>
            )}
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
