import { useEffect, useState, type ComponentType } from 'react'
import { toast } from '@/lib/toast'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { loadPalette, prefetchPalette } from './palette-loader'
import { installRecentItems } from './recent-items'
import { usePaletteShortcut } from './use-palette-shortcut'

/** What the toast says when the palette's code could not be fetched. */
export const PALETTE_LOAD_FAILED = 'The command palette could not be loaded. Try again.'

/** How long the fallback waits, where there is no idle callback, before it fetches the palette's code. */
const IDLE_FALLBACK_MS = 2000

/**
 * Where the signed-in shell mounts the palette: the ⌘K shortcut, the recents'
 * identity rule (`installRecentItems`), and the palette itself, whose code is
 * fetched on the first open and kept mounted after it, so a close can finish
 * and run an `afterClose` command. The code is also fetched once the shell is
 * idle, so the first open rarely waits; when it does, a polite "Loading
 * search…" says so, and Escape closes it. A failed fetch closes the palette
 * and says so; the next open fetches again.
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
    if (typeof requestIdleCallback === 'function') {
      const cancel = cancelIdleCallback
      const handle = requestIdleCallback(() => prefetchPalette())
      return () => cancel(handle)
    }
    const timer = setTimeout(prefetchPalette, IDLE_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!open || Palette) return
    let current = true
    loadPalette().then(
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

  if (Palette) return <Palette />
  return open ? <LoadingSearch onClose={() => setOpen(false)} /> : null
}

/** What shows while the palette's code is on its way: a light overlay and a polite status line. */
function LoadingSearch({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    /** Closes on Escape, as the palette will once it is there. */
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh]">
      <p
        role="status"
        aria-live="polite"
        className="rounded-md bg-popover px-4 py-2 text-sm text-popover-foreground shadow-md"
      >
        Loading search…
      </p>
    </div>
  )
}
