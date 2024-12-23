interface ErrorResponse {
  success: boolean
  message: string
  code: string
  statusCode: number
  errors?: {
    _errors: string[]
    [key: string]: {
      _errors: string[]
    }
  }
  meta: {
    timestamp?: string
    location?: string
  }
}

interface User {
  firstName: string
  middleName?: string
  lastName?: string
  username: string
  email: string
  role: string
  organizations: string[]
}

interface BreadcrumbItem {
  href: string
  label: string
}

interface Breadcrumbs {
  items: BreadcrumbItem[]
}
