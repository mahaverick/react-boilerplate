import { ROUTES } from '@/constants/routes'
import { safeRedirect } from '@/lib/safe-redirect'

/** Pages whose URL holds a live token. */
const TOKEN_PAGES: ReadonlySet<string> = new Set([
  ROUTES.authLink,
  ROUTES.invitationAccept,
  ROUTES.invitationConfirm,
])

/**
 * Where a sign-in may land: `safeRedirect`'s answer, unless it is a token
 * page. Carried as a redirect, a token page would mail its token again inside
 * the next link; landed on, it is the same route with a new search, so the
 * page already on screen would never act on it.
 */
export function safeLanding(value: string | null | undefined): string | null {
  const target = safeRedirect(value)
  if (!target) return null
  // The router matches paths case-insensitively and with a trailing slash, so the check must too.
  const page = new URL(target, window.location.origin).pathname.replace(/\/+$/, '').toLowerCase()
  return TOKEN_PAGES.has(page) ? null : target
}
