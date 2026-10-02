/**
 * @file The app's run-time configuration: the settings that differ between
 * environments while the image stays the same. The container's
 * `docker/10-runtime-config.sh` validates its environment at start and writes
 * `/runtime-config.js`, which index.html loads before the bundle and which
 * sets `window.__APP_CONFIG__`. A production bundle reads only that; the dev
 * server and the unit tests read the same names with a `VITE_` prefix from
 * `import.meta.env`, and Vite's dev server serves a matching
 * `/runtime-config.js` (vite.config.ts). Either way the values go through
 * `parseRuntimeConfig`, which applies the entrypoint's patterns again, so a
 * value the container would have refused never configures the app.
 */

declare global {
  interface Window {
    /** Written by `/runtime-config.js`; absent when that file did not load. */
    __APP_CONFIG__?: Readonly<Record<string, unknown>>
  }
}

/** The run-time settings, by their container environment names. */
export const RUNTIME_CONFIG_KEYS = [
  'POSTHOG_KEY',
  'POSTHOG_UI_HOST',
  'ANALYTICS_CONSENT_MODE',
  'ANALYTICS_HANDOFF_ORIGINS',
  'APP_ENVIRONMENT',
] as const

/** One run-time setting's container environment name. */
export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number]

/** An `https://` origin: a host and an optional port, no path, query or credentials. */
const HTTPS_ORIGIN = 'https://[A-Za-z0-9.-]+(:[0-9]{1,5})?'

/**
 * What a non-empty value must match; `docker/10-runtime-config.sh` holds the
 * same expressions and refuses to start the container on a mismatch. An empty
 * value always means "unset".
 */
export const RUNTIME_CONFIG_PATTERNS: Readonly<Record<RuntimeConfigKey, RegExp>> = {
  POSTHOG_KEY: /^phc_[A-Za-z0-9_-]{8,128}$/,
  POSTHOG_UI_HOST: new RegExp(`^${HTTPS_ORIGIN}$`),
  ANALYTICS_CONSENT_MODE: /^(opt_out|required|off)$/,
  ANALYTICS_HANDOFF_ORIGINS: new RegExp(`^${HTTPS_ORIGIN}(,${HTTPS_ORIGIN})*$`),
  APP_ENVIRONMENT: /^[a-z][a-z0-9-]{0,31}$/,
}

/**
 * `opt_out`: capture on until the signed-in user opts out.
 * `required`: nothing is captured until the consent banner is accepted.
 * `off`: posthog-js is never loaded.
 */
export type AnalyticsConsentMode = 'opt_out' | 'required' | 'off'

/** The validated settings. */
export interface RuntimeConfig {
  /** The PostHog project key; undefined means analytics is inert. */
  posthogKey: string | undefined
  /** PostHog's UI host, for the links posthog-js builds. */
  posthogUiHost: string
  analyticsConsentMode: AnalyticsConsentMode
  /** Origins whose links may hand an anonymous visitor's ids over. */
  analyticsHandoffOrigins: readonly string[]
  /** Sent as the `environment` property on every browser event. */
  appEnvironment: string
}

const DEFAULT_UI_HOST = 'https://us.posthog.com'
const DEFAULT_ENVIRONMENT = 'development'

/**
 * Each setting's valid value, or undefined when it is unset, empty or invalid.
 * @param raw - `window.__APP_CONFIG__`, or the dev server's env mapped to container names.
 * @returns Valid values by key.
 */
function validValues(raw: Readonly<Record<string, unknown>>): {
  values: Partial<Record<RuntimeConfigKey, string>>
  invalid: RuntimeConfigKey[]
} {
  const values: Partial<Record<RuntimeConfigKey, string>> = {}
  const invalid: RuntimeConfigKey[] = []
  for (const key of RUNTIME_CONFIG_KEYS) {
    const value = raw[key]
    if (typeof value !== 'string' || value === '') continue
    if (RUNTIME_CONFIG_PATTERNS[key].test(value)) values[key] = value
    else invalid.push(key)
  }
  return { values, invalid }
}

/**
 * Each configured origin in the canonical form `new URL(referrer).origin`
 * produces: a lowercase host, no default port.
 * @param list - A comma-separated list that already matched the origin pattern.
 * @returns The canonical origins, or undefined when one is not a URL (a port above 65535).
 */
function canonicalOrigins(list: string): string[] | undefined {
  try {
    return list.split(',').map((origin) => new URL(origin).origin)
  } catch {
    return undefined
  }
}

/**
 * Builds the configuration from raw values keyed by container name. An
 * invalid value is treated as unset, except a consent mode, which fails
 * closed: an unrecognised one turns analytics `off` rather than falling back
 * to capturing.
 * @param raw - Raw values; anything that is not a string counts as unset.
 * @returns The configuration and the names of the values that were refused.
 */
export function parseRuntimeConfig(raw: Readonly<Record<string, unknown>>): {
  config: RuntimeConfig
  invalid: RuntimeConfigKey[]
} {
  const { values, invalid } = validValues(raw)
  const handoffOrigins = values.ANALYTICS_HANDOFF_ORIGINS
    ? canonicalOrigins(values.ANALYTICS_HANDOFF_ORIGINS)
    : []
  if (handoffOrigins === undefined) invalid.push('ANALYTICS_HANDOFF_ORIGINS')
  const isConsentInvalid = invalid.includes('ANALYTICS_CONSENT_MODE')
  return {
    config: {
      posthogKey: values.POSTHOG_KEY,
      posthogUiHost: values.POSTHOG_UI_HOST ?? DEFAULT_UI_HOST,
      analyticsConsentMode: isConsentInvalid
        ? 'off'
        : ((values.ANALYTICS_CONSENT_MODE as AnalyticsConsentMode | undefined) ?? 'opt_out'),
      analyticsHandoffOrigins: handoffOrigins ?? [],
      appEnvironment: values.APP_ENVIRONMENT ?? DEFAULT_ENVIRONMENT,
    },
    invalid,
  }
}

/**
 * The dev server's and the unit tests' raw values: each container name read
 * from `import.meta.env` with a `VITE_` prefix.
 * @param env - `import.meta.env`, or a stand-in.
 * @returns Raw values keyed by container name.
 */
export function rawFromViteEnv(env: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(RUNTIME_CONFIG_KEYS.map((key) => [key, env[`VITE_${key}`]]))
}

let cached: RuntimeConfig | undefined

/**
 * This page's configuration, read once. A production bundle reads only
 * `window.__APP_CONFIG__`, so no build-time value can reach it; dev and test
 * read `VITE_*` from `import.meta.env`.
 * @returns The configuration; with nothing configured, analytics is inert.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached
  const raw = import.meta.env.PROD ? (window.__APP_CONFIG__ ?? {}) : rawFromViteEnv(import.meta.env)
  const { config, invalid } = parseRuntimeConfig(raw)
  if (invalid.length > 0) {
    console.warn(`Ignoring invalid run-time configuration: ${invalid.join(', ')}`)
  }
  cached = config
  return config
}

/** Test-only: forget the configuration read so far. */
export function resetRuntimeConfigForTests(): void {
  cached = undefined
}
