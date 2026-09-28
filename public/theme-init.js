/**
 * @file Applies the dark class before the bundle runs, from a blocking script in
 * index.html's head, so dark-mode users do not see a light first paint. A file
 * rather than an inline script so the CSP can keep script-src at 'self'.
 */

try {
  var stored = localStorage.getItem('theme')
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  var isDark = stored === 'dark' || ((stored === 'system' || !stored) && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
} catch {
  // private mode, blocked storage: fall through to light
}
