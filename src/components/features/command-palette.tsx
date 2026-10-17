import {
  IconBell,
  IconBuilding,
  IconCopy,
  IconDeviceDesktop,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { CommandPaletteShell } from '@/components/shared/command-palette/command-palette-shell'
import { copyId } from '@/components/shared/command-palette/copy-id'
import { matchCommand } from '@/components/shared/command-palette/match'
import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type {
  PaletteCommand,
  PaletteGroup,
  RecentEntry,
} from '@/components/shared/command-palette/palette-types'
import { NAV_ITEMS } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { SETTINGS_SECTIONS } from '@/constants/settings'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { useSwitchTenant } from '@/hooks/use-switch-tenant'
import { useFlagValues } from '@/observability/flags/flag-hooks'
import { filterByFlag } from '@/observability/flags/flag-values'
import { analyticsKey } from '@/observability/telemetry'
import { useLogout } from '@/queries/auth.queries'
import { useTenants, type TenantWithRole } from '@/queries/tenant.queries'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useThemeStore, type Theme } from '@/states/theme.store'

/** How many tenants Switch tenant lists for a term. */
const SWITCH_RESULTS = 8

/** The fixed `action` each kind of command sends. */
const ACTIONS = {
  page: analyticsKey('open_page'),
  recent: analyticsKey('open_recent'),
  theme: analyticsKey('set_theme'),
  signOut: analyticsKey('sign_out'),
  create: analyticsKey('create_tenant'),
  copy: analyticsKey('copy_id'),
  switch: analyticsKey('switch_tenant'),
} as const

/** The three themes, as the header's theme menu lists them. */
const THEMES: readonly { value: Theme; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
]

/** A settings section's label in Go to, where the inbox already says "Notifications". */
const SECTION_LABELS: Partial<Record<string, string>> = {
  '/settings/account/notifications': 'Notification settings',
}

/**
 * The ⌘K palette's commands: Go to (the nav, the inbox, Settings and its
 * sections, the workspace ones for the current tenant), Switch tenant (the
 * caller's tenants, filtered here, never through the API), Theme, and Account
 * (Create a tenant, Sign out). It registers Copy tenant ID for the current
 * tenant and lists the tenants switched to lately that the caller still
 * belongs to.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const query = useCommandPaletteStore((state) => state.query)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const logout = useLogout()
  const tenants = useTenants()
  const currentSlug = useCurrentTenantSlug()
  const switchTenant = useSwitchTenant()
  const flags = useFlagValues()

  const own = (tenants.data ?? []).filter((entry) => !entry.isPlatform)
  const currentTenant = own.find((entry) => entry.tenant.slug === currentSlug)

  usePaletteCommands(
    'current-tenant',
    currentTenant
      ? [
          {
            id: 'copy-tenant-id',
            label: 'Copy tenant ID',
            icon: IconCopy,
            action: ACTIONS.copy,
            timing: 'immediate',
            run: () => copyId(currentTenant.tenant.id, 'Tenant ID copied.'),
          },
        ]
      : []
  )

  /** A tenant as a Switch tenant or Recent row. */
  const tenantCommand = (
    entry: TenantWithRole,
    action: PaletteCommand['action']
  ): PaletteCommand => {
    const suspended = entry.tenant.lifecycleState === 'suspended'
    return {
      id: entry.tenant.id,
      label: entry.tenant.name,
      detail: suspended ? 'Suspended' : entry.tenant.slug,
      keywords: [entry.tenant.slug],
      icon: IconBuilding,
      disabled: suspended,
      action,
      timing: 'immediate',
      run: () => switchTenant(entry.tenant.slug),
    }
  }

  const goTo: PaletteCommand[] = [
    ...filterByFlag(NAV_ITEMS, flags).map((item) => ({
      label: item.label,
      to: item.to,
      icon: item.Icon,
    })),
    { label: 'Notifications', to: ROUTES.notifications, icon: IconBell },
    { label: 'Settings', to: ROUTES.settings, icon: IconSettings },
  ].map((item) => ({
    id: String(item.to),
    label: item.label,
    icon: item.icon,
    action: ACTIONS.page,
    timing: 'immediate',
    run: () => void navigate({ to: item.to }),
  }))
  const sections: PaletteCommand[] = SETTINGS_SECTIONS.flatMap((section): PaletteCommand[] => {
    const label = SECTION_LABELS[section.to] ?? section.label
    const base = {
      label,
      icon: section.Icon,
      keywords: ['settings'],
      action: ACTIONS.page,
      timing: 'immediate' as const,
    }
    if (section.group === 'account') {
      return [{ ...base, id: section.to, run: () => void navigate({ to: section.to }) }]
    }
    if (currentTenant === undefined) return []
    const slug = currentTenant.tenant.slug
    return [
      {
        ...base,
        id: section.to,
        detail: currentTenant.tenant.name,
        run: () => void navigate({ to: section.to, params: { slug } }),
      },
    ]
  })
  const switchable =
    query.trim() === ''
      ? []
      : own
          .map((entry) => tenantCommand(entry, ACTIONS.switch))
          .filter((command) => matchCommand(command, query))
          .slice(0, SWITCH_RESULTS)

  const groups: PaletteGroup[] = [
    { id: 'navigate', commands: [...goTo, ...sections] },
    { id: 'tenants', label: 'Switch tenant', commands: switchable },
    {
      id: 'theme',
      commands: THEMES.map(({ value, label, icon }) => ({
        id: value,
        label,
        icon,
        detail: theme === value ? 'Current' : undefined,
        keywords: ['theme', 'appearance', `${value} mode`],
        action: ACTIONS.theme,
        timing: 'immediate',
        run: () => setTheme(value),
      })),
    },
    {
      id: 'account',
      commands: [
        {
          id: 'create-tenant',
          label: 'Create a tenant',
          icon: IconPlus,
          keywords: ['new tenant', 'add tenant'],
          action: ACTIONS.create,
          timing: 'immediate',
          run: () => void navigate({ to: ROUTES.tenants, hash: 'create' }),
        },
        {
          id: 'sign-out',
          label: 'Sign out',
          icon: IconLogout,
          keywords: ['log out', 'logout'],
          disabled: logout.isPending,
          action: ACTIONS.signOut,
          timing: 'immediate',
          run: () => logout.mutate(),
        },
      ],
    },
  ]

  /** A recent tenant the caller still belongs to, other than the current one. */
  const recentToCommand = (entry: RecentEntry): PaletteCommand | null => {
    if (entry.kind !== 'tenant') return null
    const listed = own.find((row) => row.tenant.id === entry.id)
    if (listed === undefined || listed.tenant.slug === currentSlug) return null
    return tenantCommand(listed, ACTIONS.recent)
  }

  return (
    <CommandPaletteShell
      groups={groups}
      recentToCommand={recentToCommand}
      inputLabel="Search pages, tenants and actions"
      placeholder="Search pages, tenants and actions…"
      description="Go to a page, switch tenant or run an action."
    />
  )
}
