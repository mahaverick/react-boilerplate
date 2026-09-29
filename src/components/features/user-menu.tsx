import { Link } from '@tanstack/react-router'
import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
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

function initials(user: User | null): string {
  const letters = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('')
  return (letters || user?.email?.[0] || '?').toUpperCase()
}

/**
 * The account menu in the sidebar footer. Below `md` its trigger collapses to
 * the avatar, so the aria-label names it (Base UI's Tooltip emits no
 * role="tooltip" or aria-describedby); the label is on the rendered element,
 * whose own props win under useRender. For staff it links the platform tenant,
 * whose Members and Invitations pages are staff management; everything else
 * for staff is in Apex.
 */
export function UserMenu({ user }: { user: User | null }) {
  const logout = useLogout()
  const name = displayName(user)
  const staff = isStaff(user?.platformRole)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Account menu for ${name}`} />}
          >
            <Avatar size="sm">
              <AvatarFallback>{initials(user)}</AvatarFallback>
            </Avatar>
            <span className="truncate">{name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-56">
            <DropdownMenuItem render={<Link to={ROUTES.profile} />}>
              <UserIcon className="mr-2 size-4" />
              Profile
            </DropdownMenuItem>
            {staff && (
              <DropdownMenuItem
                render={<Link to="/tenants/$slug" params={{ slug: PLATFORM_TENANT_SLUG }} />}
              >
                <ShieldCheck className="mr-2 size-4" />
                Platform
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
