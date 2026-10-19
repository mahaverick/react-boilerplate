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
 * page already on screen would never act on it. A path whose escapes do not
 * decode is refused, since its route cannot be known.
 */
export function safeLanding(value: string | null | undefined): string | null {
  const target = safeRedirect(value)
  if (!target) return null
  let page: string
  try {
    // The router decodes the path before it matches, so `/auth/%6Cink` is `/auth/link` to it.
    page = decodeURIComponent(new URL(target, window.location.origin).pathname)
  } catch {
    return null
  }
  // The router matches paths case-insensitively and with a trailing slash, so the check must too.
  page = page.replace(/\/+$/, '').toLowerCase()
  return TOKEN_PAGES.has(page) ? null : target
}
