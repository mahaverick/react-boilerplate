/**
 * @file A Vite plugin that serves `/runtime-config.js` from the dev and
 * preview servers. In the image, docker/10-runtime-config.sh writes that file
 * from the container's environment; here it is rendered from the same names
 * with a `VITE_` prefix (`.env`, or the shell), the values
 * src/configs/runtime-config.ts reads outside a production bundle. index.html
 * then loads a real file on every server, and the browser sees the same
 * `window.__APP_CONFIG__` shape the image writes.
 */

/** The settings, by container name: the same list as `RUNTIME_CONFIG_KEYS`. */
export const RUNTIME_CONFIG_NAMES = [
  'POSTHOG_KEY',
  'POSTHOG_UI_HOST',
  'ANALYTICS_CONSENT_MODE',
  'ANALYTICS_HANDOFF_ORIGINS',
  'APP_ENVIRONMENT',
]

/**
 * The file's text for `env`.
 * @param env - Vite's resolved env (`VITE_*` and its own keys).
 * @returns `window.__APP_CONFIG__ = Object.freeze({...})`, every value a JSON string.
 */
export function renderRuntimeConfig(env) {
  const values = Object.fromEntries(
    RUNTIME_CONFIG_NAMES.map((name) => {
      const value = env[`VITE_${name}`]
      return [name, typeof value === 'string' ? value : '']
    })
  )
  return `window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(values, null, 2)})\n`
}

/**
 * The plugin.
 * @returns A Vite plugin answering `GET /runtime-config.js` on the dev and preview servers.
 */
export function runtimeConfigPlugin() {
  let body = renderRuntimeConfig({})
  /** @param {{ middlewares: { use: Function } }} server - The dev or preview server. */
  const serve = (server) => {
    server.middlewares.use('/runtime-config.js', (_request, response) => {
      response.setHeader('Content-Type', 'application/javascript')
      response.setHeader('Cache-Control', 'no-store')
      response.end(body)
    })
  }
  return {
    name: 'runtime-config',
    configResolved(config) {
      body = renderRuntimeConfig(config.env)
    },
    configureServer: serve,
    configurePreviewServer: serve,
  }
}
