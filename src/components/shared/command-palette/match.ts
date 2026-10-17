import type { PaletteCommand, PaletteGroup } from './palette-types'

/** Lower-cases and strips accents, so "Zoe" finds "Zoë". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Whether `command` matches `term`: the trimmed term, ignoring case and accents, is part of
 * its label, its detail (unless the detail is personal) or one of its
 * keywords. A blank term matches every command.
 * @param command - The command.
 * @param term - What is typed.
 * @returns True when the command should be listed.
 */
export function matchCommand(command: PaletteCommand, term: string): boolean {
  const needle = fold(term.trim())
  if (needle === '') return true
  const haystack = [
    command.label,
    ...(command.pii ? [] : [command.detail ?? '']),
    ...(command.keywords ?? []),
  ]
  return haystack.some((text) => fold(text).includes(needle))
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
