import { useSelector } from "react-redux"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { RootState } from "@/redux/store"

const ProtectedGuard = () => {
  const { token } = useSelector((state: RootState) => state.auth)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export default ProtectedGuard
