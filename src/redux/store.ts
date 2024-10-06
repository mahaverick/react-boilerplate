import { configureStore, Store } from "@reduxjs/toolkit"

import authReducer from "@/redux/features/auth/auth.slice"

const store: Store = configureStore({
  reducer: {
    auth: authReducer,
  },
  devTools: process.env.NODE_ENV !== "production",
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
