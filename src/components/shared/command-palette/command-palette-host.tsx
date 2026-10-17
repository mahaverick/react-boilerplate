import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { toast } from '@/lib/toast'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { loadPalette, peekPalette } from './palette-loader'
import { installRecentItems } from './recent-items'
import { usePaletteShortcut } from './use-palette-shortcut'

/** What the toast says when the palette's code could not be fetched. */
export const PALETTE_LOAD_FAILED = 'Search could not be loaded. Reloading the page will fix it.'

/** The toast's key, so a burst of failed opens shows one toast. */
const PALETTE_LOAD_FAILED_ID = 'palette-load-failed'

/** How long the fallback waits, where there is no idle callback, before it fetches the palette's code. */
const IDLE_FALLBACK_MS = 2000

/**
 * Where the signed-in shell mounts the palette: the ⌘K shortcut, the recents'
 * identity rule (`installRecentItems`), and the palette itself, whose code is
 * fetched on the first open and kept mounted after it, so a close can finish
 * and run an `afterClose` command. The code is also fetched once the shell is
 * idle, so the first open rarely waits; only an open that beats the fetch
 * shows a polite "Loading search…", which keeps what is typed meanwhile and
 * closes on Escape. A
 * failed fetch closes the palette and offers a reload: the browser keeps a
 * failed `import()` for the page's lifetime, so only a reload fetches again.
 */
export function CommandPaletteHost() {
  usePaletteShortcut()
  const open = useCommandPaletteStore((state) => state.open)
  const setOpen = useCommandPaletteStore((state) => state.setOpen)
  const [loadedPalette, setPalette] = useState<ComponentType | null>(
    () => peekPalette()?.CommandPalette ?? null
  )
  // A fetch started elsewhere (the header trigger's hover) may have resolved without this host hearing of it.
  const Palette = loadedPalette ?? peekPalette()?.CommandPalette ?? null

  useEffect(() => {
    installRecentItems()
  }, [])

  useEffect(() => {
    let mounted = true
    /** Fetches the palette's code and keeps it, unless the host is gone; a failure is left for an open to report. */
    function prefetch() {
      loadPalette().then(
        (module) => {
          if (mounted) setPalette(() => module.CommandPalette)
        },
        () => {}
      )
    }
    if (typeof requestIdleCallback === 'function') {
      const cancel = cancelIdleCallback
      const handle = requestIdleCallback(prefetch)
      return () => {
        mounted = false
        cancel(handle)
      }
    }
    const timer = setTimeout(prefetch, IDLE_FALLBACK_MS)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
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
        toast.error(PALETTE_LOAD_FAILED, {
          id: PALETTE_LOAD_FAILED_ID,
          action: { label: 'Reload', onClick: () => window.location.reload() },
        })
      }
    )
    return () => {
      current = false
    }
  }, [open, Palette, setOpen])

  if (Palette) return <Palette />
  return open ? <LoadingSearch onClose={() => setOpen(false)} /> : null
}

/**
 * What shows while the palette's code is on its way: a light overlay, a polite
 * status line and a search field that holds what is typed in the store, so
 * keys pressed right after the shortcut are not lost. Focus returns to where
 * it was when this goes, whether by Escape or because the palette takes over.
 */
function LoadingSearch({ onClose }: { onClose: () => void }) {
  const query = useCommandPaletteStore((state) => state.query)
  const setQuery = useCommandPaletteStore((state) => state.setQuery)
  const input = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const before = document.activeElement
    const field = input.current
    field?.focus()
    return () => {
      // Before the field leaves the page and the palette replacing this mounts, so that palette finds the opener focused.
      const active = document.activeElement
      if ((active === field || active === document.body) && before instanceof HTMLElement)
        before.focus()
    }
  }, [])

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
      <div className="flex w-80 flex-col gap-2 rounded-md bg-popover p-3 text-popover-foreground shadow-md">
        <input
          ref={input}
          type="text"
          aria-label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Loading search…
        </p>
      </div>
    </div>
  )
}
