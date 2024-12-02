import { useCallback } from 'react'
import { logout } from '@/endpoints/auth.endpoints'
import { useDispatch } from 'react-redux'

import { clearAuth } from '@/redux/slices/auth.slice'

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
