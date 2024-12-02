import React, { useCallback } from 'react'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutDashboard,
  LucideIcon,
  Power,
  Settings,
  Users,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useLocation } from 'react-router-dom'

import { toggleSidebar } from '@/redux/slices/sidebar.slice'
import { RootState } from '@/redux/store'
import { cn } from '@/utils/global.utils'
import { Button, ButtonProps } from '@/components/ui/button'

type Props = {
  onLogout: () => void
}

type NavButtonProps = ButtonProps & {
  to?: string
  onClick?: () => void
  isActive?: boolean
}

type NavItemType = {
  to: string
  icon: LucideIcon
  label: string
}

const navItems: NavItemType[] = [
  { to: '/dashboard', icon: Home, label: 'Home' },
  { to: '/organizations', icon: LayoutDashboard, label: 'Organizations' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
]

const bottomNavItems: NavItemType[] = [{ to: '/settings', icon: Settings, label: 'Settings' }]

const NavButton: React.FC<NavButtonProps> = ({ children, to, isActive, ...props }) =>
  to ? (
    <Link to={to} className="w-full">
      <Button
        variant={isActive ? 'secondary' : 'ghost'}
        className={cn('w-full justify-start px-2.5')}
        {...props}
      >
        {children}
      </Button>
    </Link>
  ) : (
    <Button
      variant={isActive ? 'secondary' : 'ghost'}
      className="w-full justify-start px-2.5"
      {...props}
    >
      {children}
    </Button>
  )

function Sidebar({ onLogout }: Props) {
  const dispatch = useDispatch()
  const location = useLocation()
  const isExpanded = useSelector((state: RootState) => state.sidebar.isExpanded)

  const isActive = useCallback(
    (path: string) => location.pathname.startsWith(path),
    [location.pathname]
  )

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col overflow-hidden bg-background transition-all duration-300 ease-in-out',
        isExpanded ? 'w-64' : 'w-16'
      )}
    >
      <div className="flex h-16 items-center justify-between px-4">
        {isExpanded && <span className="px-3 text-xl font-bold">Boilerplate</span>}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch(toggleSidebar())}
          className={cn('ml-auto', !isExpanded && 'mx-auto')}
        >
          {isExpanded ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
        </Button>
      </div>
      <nav className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-2">
          {navItems.map((item) => (
            <NavButton to={item.to} isActive={isActive(item.to)} key={item.to}>
              <div className="flex items-center">
                <item.icon className="size-5 shrink-0" />
                {isExpanded && (
                  <span className="ml-3 overflow-hidden transition-all duration-200">
                    {item.label}
                  </span>
                )}
              </div>
            </NavButton>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {bottomNavItems.map((item) => (
            <NavButton to={item.to} isActive={isActive(item.to)} key={item.to}>
              <div className="flex items-center">
                <item.icon className="size-5 shrink-0" />
                {isExpanded && (
                  <span className="ml-3 overflow-hidden transition-all duration-200">
                    {item.label}
                  </span>
                )}
              </div>
            </NavButton>
          ))}
          <NavButton onClick={onLogout}>
            <div className="flex items-center">
              <Power className="size-5 shrink-0" />
              {isExpanded && (
                <span className="ml-3 overflow-hidden transition-all duration-200">Logout</span>
              )}
            </div>
          </NavButton>
        </div>
      </nav>
    </aside>
  )
}

export default Sidebar
