import type { PaletteCommand, PaletteGroup } from './palette-types'

/**
 * Whether `command` matches `term`: the trimmed, lower-cased term is part of
 * its label, its detail (unless the detail is personal) or one of its
 * keywords. A blank term matches every command.
 * @param command - The command.
 * @param term - What is typed.
 * @returns True when the command should be listed.
 */
export function matchCommand(command: PaletteCommand, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [
    command.label,
    ...(command.pii ? [] : [command.detail ?? '']),
    ...(command.keywords ?? []),
  ]
  return haystack.some((text) => text.toLowerCase().includes(needle))
}

/**
 * Each group with only its matching commands, and the groups left empty dropped.
 * @param groups - The groups before matching.
 * @param term - What is typed.
 * @returns The groups to list, in the order given.
 */
export function filterGroups(groups: readonly PaletteGroup[], term: string): PaletteGroup[] {
  return groups
    .map((group) => ({
      ...group,
      commands: group.commands.filter((command) => matchCommand(command, term)),
    }))
    .filter((group) => group.commands.length > 0)
}
