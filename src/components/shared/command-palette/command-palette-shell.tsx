import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Pii } from '@/components/shared/pii'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { analyticsKey, track } from '@/observability/telemetry'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { filterGroups } from './match'
import { usePageCommands } from './palette-registry'
import {
  PALETTE_GROUP_IDS,
  PALETTE_GROUP_LABELS,
  type PaletteCommand,
  type PaletteGroup,
  type RecentEntry,
  type RemoteGroup,
} from './palette-types'
import { useRecentItems } from './recent-items'

/** The failure row's text, in place of "No results.". */
export const SEARCH_FAILED_LABEL = 'Search failed. Try again'

/** One rendered group: its heading, its key and its rows. */
interface ShownGroup {
  key: string
  heading: string
  items: ShownItem[]
}

/** One rendered row: its key and its command. */
interface ShownItem {
  key: string
  command: PaletteCommand
}

/**
 * The ⌘K palette's frame, shared by both apps. The app passes its static
 * groups, its API searches and how a recent entry becomes a command; the
 * shell adds the recents, the This page commands the mounted components
 * registered, and the failure row, matches the typed term, and runs the
 * chosen command at its `timing`. The typed term lives in the open store, so
 * the app reads the same value, and every close clears it.
 */
export function CommandPaletteShell({
  groups,
  remote = [],
  recentToCommand,
  inputLabel,
  placeholder,
  description,
}: {
  /** The app's own groups, before matching. */
  groups: readonly PaletteGroup[]
  /** The app's API searches. */
  remote?: readonly RemoteGroup[]
  /** A recent entry as a command, or null to leave it out. */
  recentToCommand: (entry: RecentEntry) => PaletteCommand | null
  inputLabel: string
  placeholder: string
  /** The dialog's hidden description: what the palette can do. */
  description: string
}) {
  const open = useCommandPaletteStore((state) => state.open)
  const query = useCommandPaletteStore((state) => state.query)
  const setOpen = useCommandPaletteStore((state) => state.setOpen)
  const setQuery = useCommandPaletteStore((state) => state.setQuery)
  const pageCommands = usePageCommands()
  const recents = useRecentItems()
  const describedBy = useId()
  /** The `afterClose` command waiting for the close to finish. */
  const pending = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
    pending.current = null
    track('command_palette_opened')
  }, [open])

  const recentCommands = recents.flatMap((entry) => {
    const command = recentToCommand(entry)
    return command ? [{ ...command, id: `${entry.kind}:${entry.id}` }] : []
  })
  const failed = remote.filter((search) => search.failed)
  const searching = remote.some((search) => search.searching)
  const statusGroup: PaletteGroup[] =
    failed.length > 0 && !searching
      ? [
          {
            id: 'status',
            commands: [
              {
                id: 'retry',
                label: SEARCH_FAILED_LABEL,
                action: analyticsKey('retry_search'),
                timing: 'stay',
                run: () => {
                  for (const search of failed) search.retry()
                },
              },
            ],
          },
        ]
      : []
  /** Tags a group with where it came from, so an app's group and a search may share an id. */
  const from = (source: string, list: readonly PaletteGroup[]) =>
    list.map((group) => ({ source, group }))
  const listed = [
    ...from(
      'static',
      filterGroups(
        [
          { id: 'recent', commands: recentCommands },
          { id: 'page', commands: pageCommands },
          ...groups,
        ],
        query
      )
    ),
    ...from(
      'remote',
      remote.map((search) => search.group).filter((group) => group.commands.length > 0)
    ),
    ...from('status', statusGroup),
  ].sort((a, b) => PALETTE_GROUP_IDS.indexOf(a.group.id) - PALETTE_GROUP_IDS.indexOf(b.group.id))
  const shown: ShownGroup[] = listed.map(({ source, group }) => ({
    key: `${source}:${group.id}`,
    heading: group.label ?? PALETTE_GROUP_LABELS[group.id],
    items: group.commands.map((command) => ({
      key: `${source}:${group.id}:${command.id}`,
      command,
    })),
  }))

  /** Records the choice, then runs it at its timing. */
  function choose(command: PaletteCommand) {
    if (command.disabled) return
    track('command_palette_action_run', { action: command.action })
    if (command.timing === 'stay') {
      command.run()
      return
    }
    if (command.timing === 'afterClose') {
      pending.current = command.run
      setOpen(false)
      return
    }
    setOpen(false)
    command.run()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return
        const run = pending.current
        pending.current = null
        run?.()
      }}
      description={description}
    >
      <Command
        open
        inline
        items={shown}
        filteredItems={shown}
        value={query}
        onValueChange={(next) => setQuery(next)}
        autoHighlight="always"
        keepHighlight
      >
        <CommandInput
          aria-label={inputLabel}
          aria-describedby={describedBy}
          placeholder={placeholder}
        />
        <p
          role="status"
          aria-live="polite"
          className="px-3 pt-2 text-xs text-muted-foreground empty:p-0"
        >
          {searching ? 'Searching…' : null}
        </p>
        <CommandEmpty>{searching ? null : 'No results.'}</CommandEmpty>
        <CommandList>
          {(group: ShownGroup) => (
            <CommandGroup key={group.key} items={group.items}>
              <CommandGroupLabel>{group.heading}</CommandGroupLabel>
              <CommandCollection>
                {({ key, command }: ShownItem) => (
                  <CommandItem
                    key={key}
                    value={{ key, command }}
                    disabled={command.disabled}
                    className="data-disabled:opacity-100"
                    onClick={() => choose(command)}
                  >
                    {command.icon && <command.icon aria-hidden="true" />}
                    <Text
                      pii={command.pii}
                      className={cn('truncate', command.disabled && 'opacity-50')}
                    >
                      {command.label}
                    </Text>
                    {command.detail && (
                      <Text
                        pii={command.pii}
                        className="ml-auto truncate text-xs text-muted-foreground"
                      >
                        <span className="sr-only">, </span>
                        {command.detail}
                      </Text>
                    )}
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
        <p id={describedBy} className="sr-only">
          Use the arrow keys to move and Enter to choose the highlighted item.
        </p>
      </Command>
    </CommandDialog>
  )
}

/** A row's text, inside `<Pii>` when it is personal. */
function Text({
  pii,
  className,
  children,
}: {
  pii?: boolean
  className: string
  children: ReactNode
}) {
  return pii ? (
    <Pii className={className}>{children}</Pii>
  ) : (
    <span className={className}>{children}</span>
  )
}
