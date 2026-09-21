import { create } from 'zustand'

interface SidebarState {
  isCollapsed: boolean
  toggle: () => void
  setCollapsed: (isCollapsed: boolean) => void
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  isCollapsed: false,
  toggle: () => set((s) => ({ isCollapsed: !s.isCollapsed })),
  setCollapsed: (isCollapsed) => set({ isCollapsed }),
}))
