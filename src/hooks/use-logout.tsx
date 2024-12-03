import { useCallback } from 'react'
import { useDispatch } from 'react-redux'

import { clearAuth } from '@/redux/slices/auth.slice'

import { logout } from '@/endpoints/auth.endpoints'

export const useLogout = () => {
  const dispatch = useDispatch()

  const handleLogout = useCallback(async () => {
    try {
      await logout()
      dispatch(clearAuth())
    } catch (error) {
      // Handle error (e.g., show a notification to the user)
      // eslint-disable-next-line no-console
      console.error('Logout failed:', error)
    }
  }, [dispatch])

  return { handleLogout }
}
