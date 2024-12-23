import { configureStore, Store } from '@reduxjs/toolkit'

import authReducer from '@/redux/slices/auth.slice'
import breadcrumbReducer from '@/redux/slices/breadcrumb.slice'
import sidebarReducer from '@/redux/slices/sidebar.slice'

const store: Store = configureStore({
  reducer: {
    authState: authReducer,
    breadcrumbState: breadcrumbReducer,
    sidebarState: sidebarReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
