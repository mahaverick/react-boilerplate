import { useEffect } from 'react'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/**
 * Toggles the palette on ⌘K or Ctrl+K while the calling component is
 * mounted. It reads the physical key (`KeyK`), so the shortcut works on
 * non-Latin layouts, and ignores repeats, IME composition, an event another
 * handler already claimed, and Shift or Alt.
 */
export function usePaletteShortcut(): void {
  const toggle = useCommandPaletteStore((state) => state.toggle)
  useEffect(() => {
    /** Toggles the palette on Cmd/Ctrl+K, ignoring repeats, composition and other modifiers. */
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.defaultPrevented) return
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.code !== 'KeyK') return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])
}
