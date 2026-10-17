import { useEffect, useState, type ComponentType } from 'react'
import { toast } from '@/lib/toast'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { installRecentItems } from './recent-items'
import { usePaletteShortcut } from './use-palette-shortcut'

/** What the toast says when the palette's code could not be fetched. */
export const PALETTE_LOAD_FAILED = 'The command palette could not be loaded. Try again.'

/**
 * Where the signed-in shell mounts the palette: the ⌘K shortcut, the recents'
 * identity rule (`installRecentItems`), and the palette itself, whose code is
 * fetched on the first open and kept mounted after it, so a close can finish
 * and run an `afterClose` command. A failed fetch closes the palette and says
 * so; the next open fetches again.
 */
export function CommandPaletteHost() {
  usePaletteShortcut()
  const open = useCommandPaletteStore((state) => state.open)
  const setOpen = useCommandPaletteStore((state) => state.setOpen)
  const [Palette, setPalette] = useState<ComponentType | null>(null)

  useEffect(() => {
    installRecentItems()
  }, [])

  useEffect(() => {
    if (!open || Palette) return
    let current = true
    import('@/components/features/command-palette').then(
      (module) => {
        if (current) setPalette(() => module.CommandPalette)
      },
      () => {
        if (!current) return
        setOpen(false)
        toast.error(PALETTE_LOAD_FAILED)
      }
    )
    return () => {
      current = false
    }
  }, [open, Palette, setOpen])

  return Palette ? <Palette /> : null
}
