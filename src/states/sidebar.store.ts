import { create } from 'zustand'

/** Whether the sidebar is collapsed, and the actions that change it. */
interface SidebarState {
  isCollapsed: boolean
  toggle: () => void
  setCollapsed: (isCollapsed: boolean) => void
}

/** The sidebar's collapsed state, shared so anything in the app can read or set it. */
export const useSidebarStore = create<SidebarState>()((set) => ({
  isCollapsed: false,
  toggle: () => set((s) => ({ isCollapsed: !s.isCollapsed })),
  setCollapsed: (isCollapsed) => set({ isCollapsed }),
}))
