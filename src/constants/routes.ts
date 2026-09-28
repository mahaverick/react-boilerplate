/**
 * The API's path prefix, fixed rather than configurable, and the one place the
 * JavaScript side writes it: the axios base, the notification stream's `fetch`
 * URL and the Google OAuth anchor all derive from it. nginx.conf hardcodes it
 * too, in `location /api/v1/notifications/stream` (the stream's buffering and
 * its query-stripping log format), so moving the API means changing this
 * constant and nginx.conf in one change. The dev proxy forwards all of `/api`.
 */
export const API_PREFIX = '/api/v1'

export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  dashboard: '/dashboard',
  profile: '/profile',
  notifications: '/notifications',
  tenants: '/tenants',
  platformActivity: '/platform/activity',
  invitationAccept: '/invitations/accept',
} as const

/** The API path for the Google OAuth start. Same-origin, so a plain anchor. */
export const GOOGLE_OAUTH_PATH = `${API_PREFIX}/auth/google`

/**
 * The platform tenant's slug, seeded by express migration 0016 and reserved
 * there. Staff management is that tenant's own Members and Invitations pages.
 */
export const PLATFORM_TENANT_SLUG = 'platform'
