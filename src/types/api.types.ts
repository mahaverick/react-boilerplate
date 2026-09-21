export interface ApiSuccess<T> {
  success: true
  message: string
  statusCode: number
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  statusCode: number
  /** Stable machine-readable discriminator, e.g. ACCESS_TOKEN_EXPIRED. */
  code?: string
  /** Field-level validator detail, shaped by the backend's Zod flatten. */
  errors?: Record<string, string[]>
  requestId: string
}

/** Exactly `toPublicUser` on the server: AuthenticatedUser plus createdAt. */
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
}

export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'
