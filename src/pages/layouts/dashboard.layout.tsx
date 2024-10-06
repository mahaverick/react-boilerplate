import { logout } from "@/endpoints/auth.endpoints"
import { useDispatch } from "react-redux"
import { Link, Outlet } from "react-router-dom"

import { clearAuth } from "@/redux/features/auth/auth.slice"
import { Button } from "@/components/ui/button"
import ErrorBoundary from "@/components/errors/error-boundary"

function DashboardLayout() {
  const dispatch = useDispatch()

  const handleLogout = async () => {
    await logout()
    dispatch(clearAuth())
  }

  return (
    <ErrorBoundary
      fallback={() => <div>Oops! Something went wrong in dashboard</div>}
      onError={(error, errorInfo) => {
        // Log the error to an error reporting service
        // logErrorToService(error, errorInfo)

        // eslint-disable-next-line no-console
        console.error("ErrorBoundary caught an error:", error, errorInfo)
      }}>
      <section className="flex min-h-screen">
        <aside className="w-64 bg-background p-4">
          <div className="flex flex-col gap-4">
            <Button variant="ghost">Dashboard</Button>
            <Link to="/organizations">
              <Button variant="ghost">Organizations</Button>
            </Link>
            <Button variant="ghost">Users</Button>
            <Button variant="ghost">Settings</Button>
            <Button variant="ghost" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </aside>
        <Outlet />
      </section>
    </ErrorBoundary>
  )
}

export default DashboardLayout
