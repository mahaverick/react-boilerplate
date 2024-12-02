import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface SidebarState {
  isExpanded: boolean
}

const initialState: SidebarState = {
  isExpanded: true,
}

const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.isExpanded = !state.isExpanded
    },
    setSidebarExpanded: (state, action: PayloadAction<boolean>) => {
      state.isExpanded = action.payload
    },
  },
})

export const { toggleSidebar, setSidebarExpanded } = sidebarSlice.actions
export default sidebarSlice.reducer
