import { refreshAccessToken } from '@/endpoints/auth.endpoints'

import { clearAuth, setAuthPending, setAuthToken, setAuthUser } from '@/redux/slices/auth.slice'
import store, { RootState } from '@/redux/store'

let isRefreshing = false
let refreshPromise: Promise<null> | null = null

export const checkAuthStatusLoader = async () => {
  const state = store.getState() as RootState
  const token = state.auth.token

  if (token) {
    return null // Return early if token exists
  }

  if (isRefreshing) {
    return refreshPromise
  }

  isRefreshing = true
  store.dispatch(setAuthPending(true))

  refreshPromise = new Promise<null>((resolve) => {
    refreshAccessToken()
      .then(({ data: response }) => {
        const newAccessToken = response.data.accessToken
        const user = response.data.user

        store.dispatch(setAuthToken({ token: newAccessToken }))
        store.dispatch(setAuthUser({ user }))
      })
      .catch((error) => {
        store.dispatch(clearAuth())
        // eslint-disable-next-line no-console
        console.error(error)
      })
      .finally(() => {
        store.dispatch(setAuthPending(false))
        isRefreshing = false
        refreshPromise = null
        resolve(null)
      })
  })

  return refreshPromise
}
