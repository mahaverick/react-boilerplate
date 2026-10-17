/**
 * @file The palette's This page commands: each component that owns an
 * action's dialog registers its commands while it is mounted.
 */
import { useEffect, useRef } from 'react'
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
    commands.map((command) => [command.id, command.label, command.detail, command.disabled])
  )
}

/**
 * Lists `commands` under This page while the calling component is mounted,
 * and removes them when it unmounts or `sourceId` changes. A re-render that
 * keeps every command's id, label, detail and disabled flag registers
 * nothing; `run` always calls the latest render's handler.
 * @param sourceId - Unique among mounted sources ("tenant-actions").
 * @param commands - This render's commands; empty registers an empty list.
 */
export function usePaletteCommands(sourceId: string, commands: readonly PaletteCommand[]): void {
  const latest = useRef(commands)
  useEffect(() => {
    latest.current = commands
  })
  const key = signature(commands)
  useEffect(() => {
    const registered = latest.current.map((command) => ({
      ...command,
      run: () => latest.current.find((next) => next.id === command.id)?.run(),
    }))
    usePaletteRegistry.setState((state) => ({
      sources: { ...state.sources, [sourceId]: registered },
    }))
  }, [sourceId, key])
  useEffect(
    () => () => {
      usePaletteRegistry.setState((state) => ({
        sources: Object.fromEntries(
          Object.entries(state.sources).filter(([id]) => id !== sourceId)
        ),
      }))
    },
    [sourceId]
  )
}

/** Every registered command, source by source. */
export function usePageCommands(): PaletteCommand[] {
  const sources = usePaletteRegistry((state) => state.sources)
  return Object.values(sources).flat()
}
