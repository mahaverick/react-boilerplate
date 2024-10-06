import { Component, ErrorInfo, ReactNode } from "react"

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | ((_error: Error, _errorInfo: ErrorInfo) => ReactNode)
  onError?: (_error: Error, _errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state
    const { children, fallback } = this.props

    if (hasError && error) {
      if (typeof fallback === "function") {
        return fallback(error, errorInfo!)
      }

      if (fallback) {
        return fallback
      }

      return (
        <div className="container h-full p-4">
          <h1 className="mb-4 text-xl">Oops! Something went wrong</h1>
          <details>
            <summary className="mt-4 cursor-pointer font-bold">Error Details</summary>
            <pre className="mt-4 h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-800 p-4 text-white">
              <p className="font-semibold">{error.toString()}</p>
              {errorInfo && <p>{errorInfo.componentStack}</p>}
            </pre>
          </details>
        </div>
      )
    }

    return children
  }
}

export default ErrorBoundary
