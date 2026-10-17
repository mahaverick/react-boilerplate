import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  usePaletteCommands,
  usePaletteRegistry,
} from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { analyticsKey } from '@/observability/telemetry'

/** A command whose `run` records `calls`. */
function command(id: string, label: string, calls: string[]): PaletteCommand {
  return {
    id,
    label,
    action: analyticsKey('page_action_suspend'),
    timing: 'afterClose',
    run: () => calls.push(`${id}:${label}`),
  }
}

describe('usePaletteCommands', () => {
  it('registers a source’s commands and removes them on unmount', () => {
    const { unmount } = renderHook(() =>
      usePaletteCommands('menu', [command('suspend', 'Suspend', [])])
    )
    expect(usePaletteRegistry.getState().sources.menu?.map((entry) => entry.id)).toEqual([
      'suspend',
    ])
    unmount()
    expect(usePaletteRegistry.getState().sources.menu).toBeUndefined()
  })

  it('does not register again for a re-render with the same commands, and runs the latest handler', () => {
    const calls: string[] = []
    const { rerender, unmount } = renderHook(
      ({ tag }: { tag: string }) => {
        const next = command('suspend', 'Suspend', calls)
        usePaletteCommands('menu', [{ ...next, run: () => calls.push(tag) }])
      },
      { initialProps: { tag: 'first' } }
    )
    const registered = usePaletteRegistry.getState().sources.menu
    rerender({ tag: 'second' })
    expect(usePaletteRegistry.getState().sources.menu).toBe(registered)
    registered?.[0]?.run()
    expect(calls).toEqual(['second'])
    unmount()
  })

  it('registers again when a command’s label, detail or disabled flag changes', () => {
    const { rerender, unmount } = renderHook(
      ({ disabled }: { disabled: boolean }) =>
        usePaletteCommands('menu', [{ ...command('sign-out', 'Sign out', []), disabled }]),
      { initialProps: { disabled: false } }
    )
    rerender({ disabled: true })
    expect(usePaletteRegistry.getState().sources.menu?.[0]?.disabled).toBe(true)
    unmount()
  })

  it('moves the commands when the source id changes', () => {
    const { rerender, unmount } = renderHook(
      ({ source }: { source: string }) => usePaletteCommands(source, [command('copy', 'Copy', [])]),
      { initialProps: { source: 'a' } }
    )
    rerender({ source: 'b' })
    expect(Object.keys(usePaletteRegistry.getState().sources)).toEqual(['b'])
    unmount()
  })
})
