import React from 'react'
import { useSelector } from 'react-redux'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { RootState } from '@/redux/store'

const AuthGuard: React.FC = () => {
  const { token, user } = useSelector((state: RootState) => state.authState)
  const location = useLocation()

  if (token) {
    if (user?.organizations && user.organizations.length > 0) {
      return <Navigate to="/dashboard" replace state={{ from: location }} />
    } else {
      return <Navigate to="/organizations/create" replace state={{ from: location }} />
    }
  }

  return <Outlet />
}

export default AuthGuard
