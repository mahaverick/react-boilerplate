import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// Define a type for the slice state
export interface SidebarState {
  isExpanded: boolean
}

// Define the initial state using that type
const initialState: SidebarState = {
  isExpanded: true,
}

const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    // Toggles the sidebar
    toggleSidebar: (state) => {
      state.isExpanded = !state.isExpanded
    },

    // Sets the sidebar expanded
    setSidebarExpanded: (state, action: PayloadAction<boolean>) => {
      state.isExpanded = action.payload
    },
  },
})

// Export action creators as named exports
export const { toggleSidebar, setSidebarExpanded } = sidebarSlice.actions

// Export reducer as default export
export default sidebarSlice.reducer
