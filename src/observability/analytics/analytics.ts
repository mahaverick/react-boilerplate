/**
 * @file The analytics facade, the only module the app calls. posthog-js is
 * loaded with a dynamic `import()` by `initAnalytics`, so none of it is in the
 * entry chunk and a page with no key never fetches it. Calls made before the SDK has loaded
 * are queued in order and replayed inside its `loaded` callback, which runs
 * before the first `$pageview`; with no key, or consent mode `off`, every call
 * is a no-op. A throwing SDK call is swallowed: analytics never fails a user
 * action.
 */
import type { PostHogInterface } from 'posthog-js'
import {
  ANALYTICS_APP,
  ANALYTICS_URL_QUERY_ALLOWLIST,
  getAnalyticsConfig,
  isAnalyticsAvailable,
  type AnalyticsConfig,
} from './config'
import type { BrowserEvent, TrackArgs } from './events'
import { isPersistedIdentified, readHandoff, stripHandoffParams } from './handoff'
import { buildPosthogOptions } from './posthog-options'

/** The API path the Express proxy forwards to PostHog. */
export const ANALYTICS_PROXY_PATH = '/api/v1/collect'

/** posthog-js's three explicit consent states. */
export type AnalyticsConsent = 'granted' | 'denied' | 'pending'

type Command = (client: PostHogInterface) => void

/**
 * Calls held before the SDK loads. Past this, the oldest queued event
 * capture is dropped to make room; identity, reset, group and consent calls
 * are never dropped, so the queue can exceed the cap only by those.
 */
export const MAX_QUEUED_COMMANDS = 100

interface QueuedCommand {
  command: Command
  /** Only an event capture may be dropped when the queue is full. */
  isDroppable: boolean
}

let status: 'idle' | 'loading' | 'ready' | 'inert' = 'idle'
let client: PostHogInterface | null = null
let queue: QueuedCommand[] = []
let activeConfig: AnalyticsConfig | null = null
let activeTenantId: string | null = null
const consentListeners = new Set<() => void>()

function notifyConsent(): void {
  for (const listener of consentListeners) listener()
}

function execute(command: Command, instance: PostHogInterface): void {
  try {
    command(instance)
  } catch {
    // Analytics never fails a user action.
  }
}

function run(command: Command, isDroppable = false): void {
  if (status === 'ready' && client) {
    execute(command, client)
    return
  }
  if (status === 'inert') return
  if (queue.length >= MAX_QUEUED_COMMANDS) {
    const oldest = queue.findIndex((queued) => queued.isDroppable)
    if (oldest !== -1) queue.splice(oldest, 1)
    else if (isDroppable) return
  }
  queue.push({ command, isDroppable })
}

function becomeInert(): void {
  status = 'inert'
  queue = []
}

/** The super properties on every browser event; `reset()` clears them, so they are set again after it. */
function registerSuperProperties(ph: PostHogInterface): void {
  ph.register({ app: ANALYTICS_APP, environment: activeConfig?.environment })
}

function onLoaded(instance: PostHogInterface): void {
  client = instance
  status = 'ready'
  execute(registerSuperProperties, instance)
  const pending = queue
  queue = []
  for (const { command } of pending) execute(command, instance)
  notifyConsent()
}

/**
 * `reset()` also clears the super properties and posthog-js's consent, so
 * both are put back after it: the next person's events still say which app
 * and environment they come from, and the browser's consent answer stands.
 */
function resetKeepingConsent(ph: PostHogInterface): void {
  const consent = ph.get_explicit_consent_status()
  ph.reset()
  registerSuperProperties(ph)
  if (consent === 'granted') ph.opt_in_capturing()
  if (consent === 'denied') ph.opt_out_capturing()
}

/**
 * Loads and starts posthog-js, once. Reads and strips the handoff parameters
 * first, whatever the configuration, so they never stay in the address bar.
 * Call it after the session restore has settled: the identity the restore
 * queues is then applied before the first `$pageview`.
 * @param config - Defaults to this page's run-time configuration.
 */
export async function initAnalytics(config: AnalyticsConfig = getAnalyticsConfig()): Promise<void> {
  if (status !== 'idle') return
  activeConfig = config
  status = 'loading'
  try {
    const key = config.key
    const handoff =
      key !== undefined && config.consentMode === 'opt_out'
        ? readHandoff(
            window.location,
            document.referrer,
            config.handoffOrigins,
            isPersistedIdentified(key)
          )
        : {}
    stripHandoffParams()
    if (key === undefined || !isAnalyticsAvailable(config)) {
      becomeInert()
      return
    }
    const { default: posthog } = await import('posthog-js')
    posthog.init(
      key,
      buildPosthogOptions({
        apiHost: `${window.location.origin}${ANALYTICS_PROXY_PATH}`,
        uiHost: config.uiHost,
        consentMode: config.consentMode === 'required' ? 'required' : 'opt_out',
        urlAllowlist: ANALYTICS_URL_QUERY_ALLOWLIST,
        bootstrap: handoff.bootstrap,
        onLoaded,
      })
    )
  } catch {
    becomeInert()
  }
}

/**
 * Sends a registered event.
 * @param event - A name from `BrowserEventProps`.
 * @param args - Its properties, or nothing for an event that has none.
 */
export function track<E extends BrowserEvent>(event: E, ...args: TrackArgs<E>): void {
  const [properties] = args
  run((ph) => ph.capture(event, properties ?? {}), true)
}

/**
 * Identifies the signed-in user by id alone: person properties are set by the
 * server, where a browser cannot forge them. A different person already
 * identified in this browser is reset first, so the new user's events never
 * carry the old distinct id.
 * @param userId - The API's user id.
 */
export function identifyUser(userId: string): void {
  run((ph) => {
    if (ph.get_property('$user_state') === 'identified' && ph.get_distinct_id() !== userId) {
      resetKeepingConsent(ph)
    }
    ph.identify(userId)
  })
}

/**
 * Puts the following events in the tenant's group. A change from one tenant
 * to another also sends `tenant_switched`; setting the same tenant again does
 * nothing. Group properties are set by the server only.
 * @param tenantId - The active tenant's id.
 */
export function setTenantGroup(tenantId: string): void {
  if (tenantId === activeTenantId) return
  const previous = activeTenantId
  activeTenantId = tenantId
  run((ph) => {
    ph.group('tenant', tenantId)
    if (previous !== null) ph.capture('tenant_switched' satisfies BrowserEvent, {})
  })
}

/** Forgets the person and the tenant: sign-out, forced or chosen. The consent answer survives. */
export function resetAnalytics(): void {
  activeTenantId = null
  run(resetKeepingConsent)
}

/**
 * Applies the signed-in user's own preference. Opting out stops capture in
 * every mode. Opting back in resumes capture in `opt_out` mode only: in
 * `required` mode consent is the banner's answer, not the profile's.
 * @param isOptedOut - The profile's `analyticsOptOut`.
 */
export function setAnalyticsOptOut(isOptedOut: boolean): void {
  run((ph) => {
    if (isOptedOut) {
      if (!ph.has_opted_out_capturing()) ph.opt_out_capturing()
    } else if (activeConfig?.consentMode === 'opt_out' && ph.has_opted_out_capturing()) {
      ph.opt_in_capturing()
    }
    notifyConsent()
  })
}

/** The banner's accept, and the profile switch turned on in `required` mode. */
export function grantAnalyticsConsent(): void {
  run((ph) => {
    ph.opt_in_capturing()
    notifyConsent()
  })
}

/** The banner's decline. */
export function denyAnalyticsConsent(): void {
  run((ph) => {
    ph.opt_out_capturing()
    notifyConsent()
  })
}

/**
 * The browser's explicit consent answer.
 * @returns Undefined until the SDK has loaded, and always when analytics is inert.
 */
export function getAnalyticsConsent(): AnalyticsConsent | undefined {
  if (status !== 'ready' || !client) return undefined
  try {
    return client.get_explicit_consent_status()
  } catch {
    return undefined
  }
}

/**
 * Subscribes to consent and load changes, for `useSyncExternalStore`.
 * @param listener - Called after each change.
 * @returns The unsubscribe.
 */
export function subscribeAnalyticsConsent(listener: () => void): () => void {
  consentListeners.add(listener)
  return () => {
    consentListeners.delete(listener)
  }
}

/**
 * The replay session id for `X-POSTHOG-SESSION-ID`, so server events link to
 * the session.
 * @returns Undefined before the SDK loads, while capture is off, and in
 *   `required` mode until consent is granted.
 */
export function getAnalyticsSessionId(): string | undefined {
  if (status !== 'ready' || !client) return undefined
  try {
    if (
      activeConfig?.consentMode === 'required' &&
      client.get_explicit_consent_status() !== 'granted'
    ) {
      return undefined
    }
    return client.has_opted_out_capturing() ? undefined : client.get_session_id()
  } catch {
    return undefined
  }
}

/** Test-only: forget the SDK, the queue, the tenant and every listener. */
export function resetAnalyticsForTests(): void {
  status = 'idle'
  client = null
  queue = []
  activeConfig = null
  activeTenantId = null
  consentListeners.clear()
}
