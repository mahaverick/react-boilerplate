export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  oauthCallback: '/auth/callback',
  dashboard: '/dashboard',
  profile: '/profile',
  notifications: '/notifications',
  tenants: '/tenants',
  tenant: (slug: string) => `/tenants/${slug}`,
  tenantMembers: (slug: string) => `/tenants/${slug}/members`,
  tenantSettings: (slug: string) => `/tenants/${slug}/settings`,
} as const

/** The API path for the Google OAuth start. Same-origin, so a plain anchor. */
export const GOOGLE_OAUTH_PATH = '/api/v1/auth/google'
