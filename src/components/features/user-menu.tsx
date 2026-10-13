import { IconBell, IconLogout, IconSelector, IconShieldCheck, IconUser } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { Pii } from '@/components/shared/pii'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { isStaff } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG, ROUTES } from '@/constants/routes'
import { fullName } from '@/lib/format'
import { useLogout } from '@/queries/auth.queries'
import type { User } from '@/types/api.types'

/**
 * "Ada Lovelace", or the email when the profile carries no name yet. Not
 * exported: `react-refresh/only-export-components` fails lint under
 * `--max-warnings 0`.
 */
function displayName(user: User | null): string {
  return fullName(user) ?? user?.email ?? 'Account'
}

/** The one or two letters shown in the avatar: the name initials, else the email's first letter. */
function initials(user: User | null): string {
  const letters = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('')
  return (letters || user?.email?.[0] || '?').toUpperCase()
}

/** The avatar circle with the initials, masked for analytics. */
function UserAvatar({ user }: { user: User | null }) {
  return (
    <Avatar className="rounded-lg">
      <AvatarFallback className="rounded-lg">
        <Pii>{initials(user)}</Pii>
      </AvatarFallback>
    </Avatar>
  )
}

/** The name over the email, each masked and truncated, as the trigger and the menu label show them. */
function UserLines({ user, name }: { user: User | null; name: string }) {
  return (
    <span className="grid flex-1 text-left text-sm leading-tight">
      <Pii className="truncate font-medium">{name}</Pii>
      {user?.email && user.email !== name && (
        <Pii className="truncate text-xs text-muted-foreground">{user.email}</Pii>
      )}
    </span>
  )
}

/**
 * The account menu in the sidebar footer, after shadcn's sidebar-07
 * `NavUser`. Its trigger shows only the avatar when the sidebar is collapsed
 * to icons, so the aria-label names it (Base UI's Tooltip emits no
 * role="tooltip" or aria-describedby); the label is on the rendered element,
 * whose own props win under useRender. The popup opens beside the sidebar on
 * desktop and above the trigger in the mobile sheet, and each link closes the
 * mobile sheet. For staff it links the platform tenant, whose Members and
 * Invitations pages are staff management; everything else for staff is in Apex.
 */
export function UserMenu({ user }: { user: User | null }) {
  const logout = useLogout()
  const { isMobile, setOpenMobile } = useSidebar()
  /** Closes the drawer after a tap on a phone, as the sidebar's own links do. */
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  const name = displayName(user)
  const staff = isStaff(user?.platformRole)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
                aria-label={`Account menu for ${name}`}
              />
            }
          >
            <UserAvatar user={user} />
            <UserLines user={user} name={name} />
            <IconSelector aria-hidden="true" className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'top' : 'right'}
            align="end"
            sideOffset={4}
            className="min-w-56"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <span className="flex items-center gap-2 px-1 py-1.5 text-foreground">
                  <UserAvatar user={user} />
                  <UserLines user={user} name={name} />
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to={ROUTES.settingsProfile} onClick={close} />}>
                <IconUser aria-hidden="true" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to={ROUTES.settingsNotifications} onClick={close} />}>
                <IconBell aria-hidden="true" />
                Notifications
              </DropdownMenuItem>
              {staff && (
                <DropdownMenuItem
                  render={
                    <Link
                      to="/tenants/$slug"
                      params={{ slug: PLATFORM_TENANT_SLUG }}
                      onClick={close}
                    />
                  }
                >
                  <IconShieldCheck aria-hidden="true" />
                  Platform
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <IconLogout aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
