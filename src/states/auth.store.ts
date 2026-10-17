import { create } from 'zustand'
import type { User } from '@/types/api.types'

/**
 * The key prefix of the command palette's recent items. Repeated here, not
 * imported, so signing out needs neither the palette nor its schema; a test
 * pins it to the palette's own constant.
 */
const PALETTE_RECENT_PREFIX = 'palette.recent.v1:'

/** Removes every stored palette recents list; blocked storage has none to remove. */
function clearPaletteRecents(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PALETTE_RECENT_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // Nothing was stored, or storage is blocked.
  }
}

/** The session's state and the actions that change it. */
interface AuthState {
  accessToken: string | null
  user: User | null
  isAuthenticated: boolean
  /** True once the one-time session restore has settled, success or failure. */
  isBootstrapped: boolean
  login: (token: string, user: User) => void
  logout: () => void
  setBootstrapped: () => void
}

/** The signed-in session: the access token and the user, held in memory only. */
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isBootstrapped: false,
  login: (accessToken, user) => set({ accessToken, user, isAuthenticated: true }),
  logout: () => {
    clearPaletteRecents()
    set({ accessToken: null, user: null, isAuthenticated: false })
  },
  setBootstrapped: () => set({ isBootstrapped: true }),
}))
