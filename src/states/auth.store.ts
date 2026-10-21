import { create } from 'zustand'
import { clearAllRecents } from '@/components/shared/command-palette/recent-keys'
import type { User } from '@/types/api.types'

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
  /** Swaps the access token and keeps the user, as a step-up confirmation does. */
  setToken: (token: string) => void
}

/** The signed-in session: the access token and the user, held in memory only. */
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isBootstrapped: false,
  login: (accessToken, user) => set({ accessToken, user, isAuthenticated: true }),
  logout: () => {
    clearAllRecents()
    set({ accessToken: null, user: null, isAuthenticated: false })
  },
  setBootstrapped: () => set({ isBootstrapped: true }),
  setToken: (accessToken) => set({ accessToken }),
}))
