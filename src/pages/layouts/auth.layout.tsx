import { Outlet, useNavigation } from 'react-router-dom'

import ErrorBoundary from '@/components/errors/error-boundary'

function AuthLayout() {
  const navigation = useNavigation()
  return (
    <ErrorBoundary
      fallback={() => <div>Oops! Something went wrong in auth</div>}
      onError={(error, errorInfo) => {
        // Log the error to an error reporting service
        // logErrorToService(error, errorInfo)

        // eslint-disable-next-line no-console
        console.error('ErrorBoundary caught an error:', error, errorInfo)
      }}
    >
      {navigation.state === 'loading' ? <div>Loading...</div> : <Outlet />}
    </ErrorBoundary>
  )
}

export default AuthLayout
