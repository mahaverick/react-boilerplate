import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// Define a type for the slice state
export interface BreadcrumbState {
  breadcrumbs: BreadcrumbItem[]
}

// Define the initial state using that type
const initialState: BreadcrumbState = {
  breadcrumbs: [],
}

const breadcrumbSlice = createSlice({
  name: 'breadcrumb',
  initialState,
  reducers: {
    // sets the breadcrumbs in the state
    setBreadcrumbs: (state, action: PayloadAction<{ breadcrumbs: BreadcrumbItem[] }>) => {
      state.breadcrumbs = action.payload.breadcrumbs
    },

    // adds a breadcrumb to the state
    addBreadcrumb: (state, action: PayloadAction<{ breadcrumb: BreadcrumbItem }>) => {
      state.breadcrumbs.push(action.payload.breadcrumb)
    },

    // removes a breadcrumb from the state
    removeBreadcrumb: (state) => {
      state.breadcrumbs.pop()
    },

    // clears the breadcrumbs in the state
    clearBreadcrumbs: (state) => {
      state.breadcrumbs = []
    },
  },
})

// Export action creators as named exports
export const { setBreadcrumbs, addBreadcrumb, removeBreadcrumb, clearBreadcrumbs } =
  breadcrumbSlice.actions

// Export reducer as default export
export default breadcrumbSlice.reducer
