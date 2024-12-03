import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { http } from '@/services/http/client'

// Define a type for the slice state
export interface AuthState {
  user: User | null
  token: string | null
  isPending: boolean
}

// Define the initial state using that type
const initialState: AuthState = {
  user: null,
  token: null,
  isPending: false,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // sets auth token in the state
    setAuthToken(state, action: PayloadAction<{ token: string }>) {
      const { payload } = action
      return {
        ...state,
        token: payload?.token,
      }
    },

    // sets auth user in the state
    setAuthUser(state, action: PayloadAction<{ user: User }>) {
      const { payload } = action
      return {
        ...state,
        user: { ...state.user, ...payload.user },
      }
    },

    // sets auth pending in the state
    setAuthPending(state, action: PayloadAction<{ isPending: boolean }>) {
      const { payload } = action
      return {
        ...state,
        isPending: payload.isPending || false,
      }
    },

    // rehydrates the auth state
    rehydrateAuth(state, action: PayloadAction<AuthState>) {
      return {
        ...state,
        ...action.payload,
      }
    },

    // clears the auth state
    clearAuth() {
      // Remove the token from the http client headers
      delete http.defaults.headers.common['Authorization']

      // Remove the token from the localStorage
      // removeAuthStorage()
      // Return the initial state
      return {
        ...initialState,
      }
    },
  },
})

// Export action creators as named exports
export const { setAuthToken, setAuthUser, clearAuth, rehydrateAuth, setAuthPending } =
  authSlice.actions

// Export reducer as default export
export default authSlice.reducer
