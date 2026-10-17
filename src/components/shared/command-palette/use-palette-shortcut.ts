import { useEffect } from 'react'
import { isApplePlatform } from '@/lib/shortcut'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/**
 * Toggles the palette on ⌘K on Apple platforms and Ctrl+K elsewhere, the
 * spelling `paletteShortcutHint` shows, while the calling component is
 * mounted. Ctrl+K on an Apple platform is left to the page, where text
 * fields use it to delete to the end of a line. The K is found by its
 * character or by its physical key (`KeyK`), so the shortcut works on
 * remapped Latin layouts and on non-Latin ones. It ignores repeats, IME
 * composition, an event another handler already claimed, and Shift or Alt.
 */
export function usePaletteShortcut(): void {
  const toggle = useCommandPaletteStore((state) => state.toggle)
  useEffect(() => {
    /** Toggles the palette on this platform's modifier plus K, ignoring repeats, composition and other modifiers. */
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.defaultPrevented) return
      if (event.shiftKey || event.altKey) return
      if (!(isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey))
        return
      if (event.code !== 'KeyK' && event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])
}
