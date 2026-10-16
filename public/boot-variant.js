/**
 * @file Picks the boot shell's variant before first paint, from a blocking
 * script in index.html's head: `data-boot="auth"` on `<html>` for a page that
 * renders the auth layout, so the shell draws a centred card rather than the
 * app frame. A file rather than an inline script so the CSP can keep
 * script-src at 'self'. Byte-identical in both apps, so the list carries both
 * apps' auth pages.
 */

var BOOT_AUTH_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/callback',
  '/invitations/accept',
  '/no-access',
]

try {
  var bootPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (BOOT_AUTH_PATHS.indexOf(bootPath) !== -1) {
    document.documentElement.setAttribute('data-boot', 'auth')
  }
} catch {
  // never block the page: without the attribute the app shell shows
}
