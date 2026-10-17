/**
 * @file The sidebar's primary navigation, which the command palette's Go to
 * group lists too.
 */
import { IconBuilding, IconLayoutDashboard } from '@tabler/icons-react'
import type { NavMainItem } from '@/components/layouts/nav-main'
import { ROUTES } from '@/constants/routes'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-types'

/**
 * One sidebar entry. `flag` hides it while that flag is off; the sidebar has
 * no tenant, so only a user-scoped flag belongs here (a tenant-scoped one
 * gates a tenant tab instead). An entry with `items` renders as a
 * collapsible group.
 */
export interface NavItem extends NavMainItem {
  flag?: BooleanClientFlagKey
}

/** The sidebar's primary navigation. `to` is typed against the route tree, so a missing route is a type error. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.dashboard, label: 'Dashboard', Icon: IconLayoutDashboard },
  { to: ROUTES.tenants, label: 'Tenants', Icon: IconBuilding },
]
