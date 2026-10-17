import { describe, expect, it } from 'vitest'
import { filterGroups, matchCommand } from '@/components/shared/command-palette/match'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { analyticsKey } from '@/observability/telemetry'

/** A command with the given text fields. */
function command(fields: Partial<PaletteCommand>): PaletteCommand {
  return {
    id: 'id',
    label: 'Label',
    action: analyticsKey('open_page'),
    timing: 'immediate',
    run: () => {},
    ...fields,
  }
}

describe('matchCommand', () => {
  it('matches the label, the detail and a keyword, trimmed and in any case', () => {
    expect(matchCommand(command({ label: 'Dark' }), '  DAR ')).toBe(true)
    expect(matchCommand(command({ detail: 'acme' }), 'acm')).toBe(true)
    expect(matchCommand(command({ keywords: ['log out'] }), 'log o')).toBe(true)
    expect(matchCommand(command({ label: 'Dark' }), 'light')).toBe(false)
  })

  it('matches everything for a blank term', () => {
    expect(matchCommand(command({}), '   ')).toBe(true)
  })

  it('never matches a personal detail', () => {
    expect(
      matchCommand(command({ label: 'cleo@example.com', detail: 'Cleo Doe', pii: true }), 'doe')
    ).toBe(false)
    expect(
      matchCommand(command({ label: 'cleo@example.com', detail: 'Cleo Doe', pii: true }), 'cleo@')
    ).toBe(true)
  })
})

describe('filterGroups', () => {
  it('keeps the matching commands and drops the empty groups', () => {
    const groups = filterGroups(
      [
        {
          id: 'navigate',
          commands: [command({ id: 'a', label: 'Tenants' }), command({ id: 'b', label: 'Users' })],
        },
        { id: 'theme', commands: [command({ id: 'c', label: 'Dark' })] },
      ],
      'ten'
    )
    expect(groups.map((group) => [group.id, group.commands.map((entry) => entry.id)])).toEqual([
      ['navigate', ['a']],
    ])
  })
})
