// Runs before the bundle, from a blocking <script src> in index.html's <head>.
// Without it the page paints light and then flips to dark on every load for
// dark-mode users. It is a file rather than an inline script so the
// Content-Security-Policy can hold script-src to 'self'.
try {
  var stored = localStorage.getItem('theme')
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  var isDark = stored === 'dark' || ((stored === 'system' || !stored) && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
} catch {
  /* private mode, blocked storage: fall through to light */
}
