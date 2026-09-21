import { create } from 'zustand'
import type { User } from '@/types/api.types'

interface AuthState {
  accessToken: string | null
  user: User | null
  isAuthenticated: boolean
  /** True once the one-time session restore has settled, success or failure. */
  isBootstrapped: boolean
  login: (token: string, user: User) => void
  logout: () => void
  setToken: (token: string) => void
  setBootstrapped: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isBootstrapped: false,
  login: (accessToken, user) => set({ accessToken, user, isAuthenticated: true }),
  logout: () => set({ accessToken: null, user: null, isAuthenticated: false }),
  setToken: (accessToken) => set({ accessToken }),
  setBootstrapped: () => set({ isBootstrapped: true }),
}))
