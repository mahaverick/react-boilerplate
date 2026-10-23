import { FRONTEND_APP } from '@/constants/frontend-app'

/**
 * The API's path prefix, fixed rather than configurable, and where the
 * JavaScript side writes it for the app's own API calls: the axios base, the
 * notification stream's `fetch` URL and the Google OAuth anchor all derive
 * from it (the analytics proxy path repeats it). nginx.conf hardcodes it too,
 * in `location /api/v1/notifications/stream` (the stream's buffering and its
 * query-stripping log format) and `location /api/v1/collect/`, so moving the
 * API means changing this constant and nginx.conf in one change. The dev proxy
 * forwards all of `/api`.
 */
export const API_PREFIX = '/api/v1'

/** The app's own paths, `as const` so a `to:` built from them is checked against the route tree. */
export const ROUTES = {
  home: '/',
  login: '/login',
  authConfirm: '/auth/confirm',
  authLink: '/auth/link',
  dashboard: '/dashboard',
  welcome: '/welcome',
  settings: '/settings',
  settingsProfile: '/settings/account/profile',
  settingsNotifications: '/settings/account/notifications',
  notifications: '/notifications',
  tenants: '/tenants',
  invitationAccept: '/invitations/accept',
  invitationConfirm: '/invitations/confirm',
} as const

/** The API path for the Google OAuth start. Same-origin, so a plain anchor. */
export const GOOGLE_OAUTH_PATH = `${API_PREFIX}/auth/google?app=${FRONTEND_APP}`

/**
 * The platform tenant's slug, seeded by express migration 0016 and reserved
 * there. Staff management is that tenant's own Members and Invitations pages.
 */
export const PLATFORM_TENANT_SLUG = 'platform'
