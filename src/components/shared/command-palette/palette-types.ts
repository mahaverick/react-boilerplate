/**
 * @file The command palette's shapes: a command, the fixed groups it is shown
 * in, a search group fed by the API, and a recent item.
 */
import type { TablerIcon } from '@tabler/icons-react'
import type { AnalyticsKey } from '@/observability/telemetry'

/** The palette's groups, in the order the shell shows them. */
export const PALETTE_GROUP_IDS = [
  'recent',
  'page',
  'navigate',
  'tenants',
  'users',
  'theme',
  'account',
  'status',
] as const

/** One of the palette's groups. Apps never add another, so the order is the same in both. */
export type PaletteGroupId = (typeof PALETTE_GROUP_IDS)[number]

/** Each group's heading unless the group passes its own. */
export const PALETTE_GROUP_LABELS: Record<PaletteGroupId, string> = {
  recent: 'Recent',
  page: 'This page',
  navigate: 'Go to',
  tenants: 'Tenants',
  users: 'Users',
  theme: 'Theme',
  account: 'Account',
  status: 'Search',
}

/**
 * When a command runs. `immediate`: in the click or Enter, as the palette
 * closes (navigate, theme, copy, sign out). `afterClose`: once the palette has
 * finished closing (opens a dialog). `stay`: in the gesture, and the palette
 * stays open (Try again).
 */
export type PaletteTiming = 'immediate' | 'afterClose' | 'stay'

/** One choosable row. */
export interface PaletteCommand {
  /** Stable and unique within its group; the list key. */
  id: string
  label: string
  /** Extra words the matcher accepts ("dark mode", "log out"). */
  keywords?: readonly string[]
  /** Muted text on the right: a slug, a state, a name. */
  detail?: string
  icon?: TablerIcon
  /** Render the label and the detail inside `<Pii>`. */
  pii?: boolean
  /** Shown but not choosable, with `detail` saying why ("Suspended"). */
  disabled?: boolean
  /** The fixed analytics key sent as `command_palette_action_run`'s `action`. */
  action: AnalyticsKey
  timing: PaletteTiming
  run: () => void
}

/** A group of commands. `label` replaces the group's default heading. */
export interface PaletteGroup {
  id: PaletteGroupId
  label?: string
  commands: readonly PaletteCommand[]
}

/** A group whose rows come from the API, with its request state. */
export interface RemoteGroup {
  /** The rows for the typed term; empty while they are stale, pending or failed. */
  group: PaletteGroup
  /** The term's results are still to come. */
  searching: boolean
  /** The term's request failed with anything but a role refusal. */
  failed: boolean
  /** Asks again for the term's results. */
  retry: () => void
}

/** What a recent item can be. */
export type RecentKind = 'tenant' | 'user'

/** One tenant or user opened lately, as `localStorage` holds it. */
export interface RecentEntry {
  kind: RecentKind
  id: string
  /** The name or email the item's page shows. */
  label: string
  /** The muted text the page shows beside it: a tenant's slug. */
  detail?: string
  /** When it was opened, in milliseconds since the epoch. */
  at: number
}
