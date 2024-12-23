import React from 'react'
import { useSelector } from 'react-redux'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { RootState } from '@/redux/store'

const ProtectedGuard: React.FC = () => {
  const { token } = useSelector((state: RootState) => state.authState)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export default ProtectedGuard
