/**
 * @file The palette's This page commands: each component that owns an
 * action's dialog registers its commands while it is mounted.
 */
import { useEffect, useId, useRef } from 'react'
import { create } from 'zustand'
import type { PaletteCommand } from './palette-types'

/** The registered commands, by the source that registered them. */
interface PaletteRegistryState {
  sources: Readonly<Record<string, readonly PaletteCommand[]>>
}

/** Every mounted source's commands, in registration order. */
export const usePaletteRegistry = create<PaletteRegistryState>()(() => ({ sources: {} }))

/** What a re-render must change for a source to register again. */
function signature(commands: readonly PaletteCommand[]): string {
  return JSON.stringify(
    commands.map((command) => [
      command.id,
      command.label,
      command.detail,
      command.disabled,
      command.action,
      command.timing,
      command.keywords,
      command.pii,
    ])
  )
}

/**
 * Lists `commands` under This page while the calling component is mounted,
 * and removes them when it unmounts or `sourceId` changes. A re-render that
 * keeps every command's id, label, detail, disabled flag, action, timing,
 * keywords and pii flag registers nothing; `run` always calls the latest render's handler.
 * @param sourceId - Names the source ("tenant-actions"). Each mount registers
 *   under its own key, so two mounts of one source never replace each other.
 * @param commands - This render's commands; empty registers an empty list.
 */
export function usePaletteCommands(sourceId: string, commands: readonly PaletteCommand[]): void {
  const latest = useRef(commands)
  useEffect(() => {
    latest.current = commands
  })
  const key = signature(commands)
  const mountId = useId()
  const slot = `${sourceId}#${mountId}`
  useEffect(() => {
    const registered = latest.current.map((command) => ({
      ...command,
      run: () => latest.current.find((next) => next.id === command.id)?.run(),
    }))
    usePaletteRegistry.setState((state) => ({
      sources: { ...state.sources, [slot]: registered },
    }))
  }, [slot, key])
  useEffect(
    () => () => {
      usePaletteRegistry.setState((state) => ({
        sources: Object.fromEntries(Object.entries(state.sources).filter(([id]) => id !== slot)),
      }))
    },
    [slot]
  )
}

/**
 * Every registered command, source by source. Each id is prefixed with its
 * source's slot, so two sources that register the same id never collide.
 * @returns The commands, in registration order.
 */
export function usePageCommands(): PaletteCommand[] {
  const sources = usePaletteRegistry((state) => state.sources)
  return Object.entries(sources).flatMap(([slot, commands]) =>
    commands.map((command) => ({ ...command, id: `${slot}:${command.id}` }))
  )
}
