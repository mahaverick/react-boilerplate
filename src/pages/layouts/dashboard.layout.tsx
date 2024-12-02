import { ErrorInfo, useCallback } from 'react'
import { useSelector } from 'react-redux'
import { Outlet } from 'react-router-dom'

import { RootState } from '@/redux/store'
import { cn } from '@/utils/global.utils'
import { useLogout } from '@/hooks/use-logout'
import ErrorBoundary from '@/components/errors/error-boundary'
import Header from '@/components/features/header'
import Sidebar from '@/components/features/sidebar'

function DashboardLayout() {
  const { handleLogout } = useLogout()
  const { isExpanded } = useSelector((state: RootState) => state.sidebar)
  const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }, [])

  return (
    <ErrorBoundary
      fallback={() => <div>Oops! Something went wrong in dashboard</div>}
      onError={handleError}
    >
      <section className="flex min-h-screen">
        <Sidebar onLogout={handleLogout} />
        <Header />
        <main
          className={cn(
            'mt-16 min-h-[calc(100%-4rem)] flex-1 bg-background px-6 py-3 transition-all duration-300',
            isExpanded ? 'ml-64' : 'ml-16'
          )}
        >
          <Outlet />
        </main>
      </section>
    </ErrorBoundary>
  )
}

export default DashboardLayout
