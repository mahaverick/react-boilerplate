import { ErrorInfo, useCallback } from "react"
import { useSelector } from "react-redux"
import { Outlet } from "react-router-dom"

import { RootState } from "@/redux/store"
import { cn } from "@/utils/global.utils"
import { useLogout } from "@/hooks/use-logout"
// import { Input } from "@/components/ui/input"
import ErrorBoundary from "@/components/errors/error-boundary"
import Sidebar from "@/components/features/sidebar"

function DashboardLayout() {
  const { handleLogout } = useLogout()
  const { isExpanded } = useSelector((state: RootState) => state.sidebar)
  const { user } = useSelector((state: RootState) => state.auth)
  const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
    // Log the error to an error reporting service
    // logErrorToService(error, errorInfo)

    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }, [])

  return (
    <ErrorBoundary
      fallback={() => <div>Oops! Something went wrong in dashboard</div>}
      onError={handleError}>
      <section className="flex min-h-screen">
        <Sidebar onLogout={handleLogout} />
        <header
          className={cn(
            "fixed left-0 right-0 top-0 z-20 flex h-16 items-center justify-end bg-background px-6 py-3 transition-all duration-300",
            isExpanded ? "ml-64" : "ml-16"
          )}>
          {/* <div className="flex items-center space-x-4">
            <Input type="search" placeholder="Search..." className="w-64" />
          </div> */}
          <span className="text-lg">{`Welcome, ${user?.firstName} ${user?.lastName}`}</span>
        </header>
        <main
          className={cn(
            "mt-16 flex-1 bg-background px-6 py-3 transition-all duration-300",
            isExpanded ? "ml-64" : "ml-16"
          )}>
          <Outlet />
        </main>
      </section>
    </ErrorBoundary>
  )
}

export default DashboardLayout
