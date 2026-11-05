/**
 * @file The Settings area's one source of truth: its groups and sections drive
 * the settings nav, the `/settings` landing page and the settings layout's
 * title, after Pulse's `settings.constants.ts`.
 */
import {
  IconActivity,
  IconBell,
  IconBuilding,
  IconCreditCard,
  IconTrash,
  IconShieldLock,
  IconUser,
  IconUsers,
  type TablerIcon,
} from '@tabler/icons-react'

/** A settings group's id. */
export type SettingsGroupId = 'account' | 'workspace'

/** One labelled group of the settings nav and landing page. */
export interface SettingsGroup {
  id: SettingsGroupId
  label: string
  description: string
}

/** The groups, in the order the nav and landing page show them. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'account', label: 'Account', description: 'Your profile, sign-in and notifications.' },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'The current workspace’s details, members and activity.',
  },
]

/** An account settings page's path. */
export type AccountSettingsPath =
  | '/settings/account/profile'
  | '/settings/account/security'
  | '/settings/account/notifications'
  | '/settings/account/delete'

/** A workspace settings page's path, under the tenant it acts on. */
export type WorkspaceSettingsPath =
  | '/settings/workspace/$slug/general'
  | '/settings/workspace/$slug/members'
  | '/settings/workspace/$slug/billing'
  | '/settings/workspace/$slug/activity'

/** One settings page: where it lives, what it is called, and its group. */
export type SettingsSection = { label: string; description: string; Icon: TablerIcon } & (
  | { group: 'account'; to: AccountSettingsPath }
  | { group: 'workspace'; to: WorkspaceSettingsPath }
)

/** Every settings page, grouped in `SETTINGS_GROUPS` order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    group: 'account',
    to: '/settings/account/profile',
    label: 'Profile',
    description: 'Your name and analytics choices.',
    Icon: IconUser,
  },
  {
    group: 'account',
    to: '/settings/account/security',
    label: 'Security',
    description: 'Your sign-in methods and other sessions.',
    Icon: IconShieldLock,
  },
  {
    group: 'account',
    to: '/settings/account/notifications',
    label: 'Notifications',
    description: 'How each kind of notification reaches you.',
    Icon: IconBell,
  },
  {
    group: 'account',
    to: '/settings/account/delete',
    label: 'Delete account',
    description: 'Ask us to delete your account.',
    Icon: IconTrash,
  },
  {
    group: 'workspace',
    to: '/settings/workspace/$slug/general',
    label: 'General',
    description: 'The workspace’s details, time zone, and language and region.',
    Icon: IconBuilding,
  },
  {
    group: 'workspace',
    to: '/settings/workspace/$slug/members',
    label: 'Members',
    description: 'Members, roles and pending invitations.',
    Icon: IconUsers,
  },
  {
    group: 'workspace',
    to: '/settings/workspace/$slug/billing',
    label: 'Billing',
    description: 'Plan, usage, card and invoices.',
    Icon: IconCreditCard,
  },
  {
    group: 'workspace',
    to: '/settings/workspace/$slug/activity',
    label: 'Activity',
    description: 'Every change made in this workspace, newest first.',
    Icon: IconActivity,
  },
]

/** The landing page's subtitle, and the layout's when no section is active. */
export const SETTINGS_DESCRIPTION = 'Manage your account and the current workspace.'

/**
 * Whether `pathname` (a trailing slash ignored) has exactly the segments of
 * `to`, `$slug` matching any one non-empty segment.
 */
function matchesSection(pathname: string, to: string): boolean {
  const path = pathname.replace(/(.)\/+$/, '$1').split('/')
  const target = to.split('/')
  if (path.length !== target.length) return false
  return target.every((segment, index) =>
    segment === '$slug' ? (path[index] ?? '') !== '' : segment === path[index]
  )
}

/**
 * The section `pathname` shows, or null on the landing page and outside
 * settings. Whole segments only, so `/settings/account/profiles` matches none.
 */
export function settingsActiveSection(pathname: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => matchesSection(pathname, section.to)) ?? null
}

/** Whether `pathname` is `/settings` or one of its pages. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}
