import { useEffect } from 'react'
import { isApplePlatform } from '@/lib/shortcut'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/** Whether the key event is the K: by its character if that is a Latin letter, else by its physical key. */
function isK(event: KeyboardEvent): boolean {
  return /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === 'k' : event.code === 'KeyK'
}

/**
 * Toggles the palette on ⌘K on Apple platforms and Ctrl+K elsewhere, the
 * spelling `paletteShortcutHint` shows, while the calling component is
 * mounted. Ctrl+K on an Apple platform is left to the page, where text
 * fields use it to delete to the end of a line. The K is found by its
 * character when the key types a Latin letter, so a remapped layout (Dvorak,
 * Colemak) follows what its keys type; only where the key types no Latin
 * letter (a Cyrillic or Greek layout) is it found by its physical position
 * (`KeyK`). It ignores repeats, IME
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
      if (!isK(event)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])
}
