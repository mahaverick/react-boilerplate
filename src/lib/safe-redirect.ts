/** The longest redirect path the API accepts, so a longer one would answer 400 and block signing in. */
export const MAX_REDIRECT_LENGTH = 2048

/**
 * Whether a value contains a backslash, a C0 control character or DEL. The API
 * refuses all of them anywhere in a redirect, query and hash included, and the
 * URL parser keeps a backslash there, so this must refuse them too.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\' || code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Where to go after a successful sign-in, or `null` to use the dashboard.
 *
 * `?redirect=` is written by `_app`'s guard and `redirectToLogin`, but it
 * arrives from the URL bar and is attacker-controlled: an absolute URL there
 * would make this page an open redirect. So the value must start with `/`
 * (which keeps out a bare relative value and a `javascript:` scheme), and is
 * then resolved by the URL parser rather than matched by a pattern, since
 * both cases below pass a `^/(?![/\\])`-style test. `/\t/evil.example` loses
 * its control character and resolves off this origin, which the origin check
 * refuses. `/..//evil.example` resolves same-origin to the pathname
 * `//evil.example`, protocol-relative once assigned, which the re-check for a
 * leading `//` refuses. A value the parser cannot resolve is refused, and so
 * is a backslash or control character anywhere, and a path longer than
 * `MAX_REDIRECT_LENGTH`, which the API would refuse.
 *
 * The whole same-origin `pathname + search + hash` is returned, so a query
 * survives.
 */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null
  if (value.length > MAX_REDIRECT_LENGTH || hasUnsafeCharacter(value)) return null
  try {
    const resolved = new URL(value, window.location.origin)
    if (resolved.origin !== window.location.origin) return null
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
    if (path.length > MAX_REDIRECT_LENGTH || hasUnsafeCharacter(path)) return null
    // Same origin is not enough: "/..//evil.example" resolves to the pathname "//evil.example".
    return path.startsWith('/') && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}
