/**
 * The API's path prefix, and the ONE place it is written.
 *
 * It is FIXED, not configurable, and that is a statement about the system
 * rather than a preference. Four things hardcode it and only one of them is
 * JavaScript: nginx routes `location /api/v1/notifications/stream` (its SSE
 * buffering and its token-stripping log format hang off that exact prefix),
 * the notification stream builds its URL from a string via `fetch` because
 * it ignores axios entirely, the Google OAuth control is a plain same-origin
 * anchor, and the dev server proxies `/api`. A build that moved the axios
 * base alone would leave the other three pointing at the old path — so
 * sign-in by Google and the whole notification stream would break, silently,
 * in a build that otherwise looked healthy.
 *
 * Everything on the JavaScript side therefore derives from here. Moving the
 * API to another prefix means changing this constant AND `nginx.conf` AND
 * `vite.config.ts`'s proxy, in one change.
 */
export const API_PREFIX = '/api/v1'

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
  tenantActivity: (slug: string) => `/tenants/${slug}/activity`,
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
