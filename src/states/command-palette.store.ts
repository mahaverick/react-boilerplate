import { create } from 'zustand'

/** The palette's open flag, what is typed in it, and the ways to change them. */
interface CommandPaletteState {
  open: boolean
  /** The palette input's text. Every close clears it. */
  query: string
  setOpen: (open: boolean) => void
  toggle: () => void
  setQuery: (query: string) => void
}

/**
 * Whether the ⌘K palette is open, and what is typed in it. The header's
 * search button, the shortcut and the palette share it. A close, however it
 * happens, clears the query, so the palette always opens empty.
 */
export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  query: '',
  setOpen: (open) => set(open ? { open } : { open, query: '' }),
  toggle: () => set((state) => (state.open ? { open: false, query: '' } : { open: true })),
  setQuery: (query) => set({ query }),
}))
