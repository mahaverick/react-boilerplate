import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  usePageCommands,
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

/** The commands a source registered, whichever mount registered them. */
function registered(sourceId: string): PaletteCommand[] {
  return Object.entries(usePaletteRegistry.getState().sources)
    .filter(([key]) => key.startsWith(`${sourceId}#`))
    .flatMap(([, commands]) => [...commands])
}

describe('usePaletteCommands', () => {
  it('lists two sources that register the same id under distinct ids, each running its own', () => {
    const calls: string[] = []
    const { result, unmount } = renderHook(() => {
      usePaletteCommands('tabs', [command('copy-id', 'Copy tab ID', calls)])
      usePaletteCommands('menu', [command('copy-id', 'Copy row ID', calls)])
      return usePageCommands()
    })
    const ids = result.current.map((entry) => entry.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    result.current.forEach((entry) => entry.run())
    expect(calls).toEqual(['copy-id:Copy tab ID', 'copy-id:Copy row ID'])
    unmount()
  })

  it('registers a source’s commands and removes them on unmount', () => {
    const { unmount } = renderHook(() =>
      usePaletteCommands('menu', [command('suspend', 'Suspend', [])])
    )
    expect(registered('menu').map((entry) => entry.id)).toEqual(['suspend'])
    unmount()
    expect(registered('menu')).toEqual([])
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
    const before = usePaletteRegistry.getState().sources
    rerender({ tag: 'second' })
    expect(usePaletteRegistry.getState().sources).toBe(before)
    registered('menu')[0]?.run()
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
    expect(registered('menu')[0]?.disabled).toBe(true)
    unmount()
  })

  it('moves the commands when the source id changes', () => {
    const { rerender, unmount } = renderHook(
      ({ source }: { source: string }) => usePaletteCommands(source, [command('copy', 'Copy', [])]),
      { initialProps: { source: 'a' } }
    )
    rerender({ source: 'b' })
    expect(registered('a')).toEqual([])
    expect(registered('b').map((entry) => entry.id)).toEqual(['copy'])
    unmount()
  })

  it('registers again when only pii, action, timing or keywords change', () => {
    const { rerender, unmount } = renderHook(
      ({ pii }: { pii: boolean }) =>
        usePaletteCommands('menu', [{ ...command('person', 'Cleo', []), pii }]),
      { initialProps: { pii: false } }
    )
    expect(registered('menu')[0]?.pii).toBe(false)
    rerender({ pii: true })
    expect(registered('menu')[0]?.pii).toBe(true)
    unmount()
    const next = renderHook(
      ({ timing, keywords }: { timing: 'immediate' | 'afterClose'; keywords: string[] }) =>
        usePaletteCommands('menu', [{ ...command('a', 'A', []), timing, keywords }]),
      { initialProps: { timing: 'immediate' as const, keywords: ['x'] } }
    )
    next.rerender({ timing: 'afterClose' as never, keywords: ['x'] })
    expect(registered('menu')[0]?.timing).toBe('afterClose')
    next.rerender({ timing: 'afterClose' as never, keywords: ['y'] })
    expect(registered('menu')[0]?.keywords).toEqual(['y'])
    next.unmount()
  })

  it('keeps two mounts of one source id apart', () => {
    const first = renderHook(() => usePaletteCommands('menu', [command('a', 'A', [])]))
    const second = renderHook(() => usePaletteCommands('menu', [command('b', 'B', [])]))
    expect(
      registered('menu')
        .map((entry) => entry.id)
        .sort()
    ).toEqual(['a', 'b'])
    first.unmount()
    expect(registered('menu').map((entry) => entry.id)).toEqual(['b'])
    second.unmount()
    expect(registered('menu')).toEqual([])
  })

  it('stays registered under StrictMode and leaves nothing behind', () => {
    const { unmount } = renderHook(
      () => usePaletteCommands('menu', [command('suspend', 'Suspend', [])]),
      { wrapper: StrictMode }
    )
    expect(registered('menu').map((entry) => entry.id)).toEqual(['suspend'])
    unmount()
    expect(registered('menu')).toEqual([])
  })
})
