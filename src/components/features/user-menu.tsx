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
import { useLogout } from '@/queries/auth.queries'
import type { User } from '@/types/api.types'

/**
 * "Ada Lovelace", or the email when the profile carries no name yet.
 *
 * Module-private on purpose: `react-refresh/only-export-components` is a
 * warning and the gate runs `--max-warnings 0`, so a non-component export
 * beside a component here would fail lint.
 */
function displayName(user: User | null): string {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return full || (user?.email ?? 'Account')
}

function initials(user: User | null): string {
  const letters = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('')
  return (letters || user?.email?.[0] || '?').toUpperCase()
}

export function UserMenu({ user }: { user: User | null }) {
  const logout = useLogout()
  const name = displayName(user)
  const staff = isStaff(user?.platformRole)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          {/* The trigger collapses to just the avatar below `md`, so it is an
              icon-only control there. Base UI's Tooltip emits no role="tooltip"
              and no aria-describedby, so a tooltip would NOT name it — the
              aria-label is what Task 9's axe `button-name` check reads. It is on
              the rendered element because useRender lets that element's own
              props win over the trigger's. */}
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
            {/* The platform tenant is left out of the switcher; this is its
                door. Its Members and Invitations pages ARE staff management. */}
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
