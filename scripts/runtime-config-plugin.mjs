/**
 * @file A Vite plugin that serves `/runtime-config.js` from the dev and
 * preview servers, so index.html loads a real file on every server. The image
 * gets that file from docker/10-runtime-config.sh; here it is rendered from the
 * same names with a `VITE_` prefix (`.env`, or the shell) and defines the same
 * `window.__APP_CONFIG__` shape.
 */

/** The settings by container name; a test keeps this list equal to `RUNTIME_CONFIG_KEYS`. */
export const RUNTIME_CONFIG_NAMES = [
  'POSTHOG_KEY',
  'POSTHOG_UI_HOST',
  'ANALYTICS_CONSENT_MODE',
  'ANALYTICS_HANDOFF_ORIGINS',
  'APP_ENVIRONMENT',
]

/**
 * The text of `/runtime-config.js` for `env`: each listed setting as a string,
 * empty when unset. `JSON.stringify` escapes the values, so a quote or newline
 * in one cannot end its string literal.
 * @param env - Vite's resolved env: the `VITE_*` variables and Vite's own keys.
 * @returns A `window.__APP_CONFIG__ = Object.freeze({...})` statement.
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
 * A Vite plugin that serves the rendered `/runtime-config.js`, uncached, on the
 * dev and preview servers. The body is rendered once, when the config
 * resolves, so it holds the env as of server start.
 */
export function runtimeConfigPlugin() {
  let body = renderRuntimeConfig({})
  /**
   * Mounts the `/runtime-config.js` handler on a dev or preview server.
   * @param server - The server whose middleware stack gets the handler.
   */
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
