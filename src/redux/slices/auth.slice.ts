import { createSlice } from "@reduxjs/toolkit"

import { http } from "@/services/http/client"

interface AuthState {
  user: User | null
  token: string | null
  isPending: boolean
}

const initialState: AuthState = {
  user: null,
  token: null,
  isPending: false,
}

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuthToken(state, action) {
      const { payload } = action
      return {
        ...state,
        token: payload?.token,
      }
    },
    setAuthUser(state, action) {
      const { payload } = action
      return {
        ...state,
        user: { ...state.user, ...payload.user },
      }
    },
    setAuthPending(state, action) {
      const { payload } = action
      return {
        ...state,
        isPending: payload.isPending || false,
      }
    },
    rehydrateAuth(state, action) {
      return {
        ...state,
        ...action.payload,
      }
    },
    clearAuth() {
      // Remove the token from the http client headers
      delete http.defaults.headers.common["Authorization"]

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
