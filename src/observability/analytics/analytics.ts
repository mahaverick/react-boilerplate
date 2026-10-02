/**
 * @file The analytics facade, the only module the app calls. posthog-js is
 * loaded with a dynamic `import()` by `initAnalytics`, so none of it is in the
 * entry chunk and a page with no key never fetches it. Calls made before the SDK has loaded
 * are queued in order and replayed inside its `loaded` callback, which runs
 * before any event; with no key, or consent mode `off`, every call
 * is a no-op. A throwing SDK call is swallowed: analytics never fails a user
 * action.
 */
import type { CaptureResult, PostHog, PostHogInterface } from 'posthog-js'
import {
  ANALYTICS_APP,
  ANALYTICS_CROSS_SUBDOMAIN_COOKIE,
  ANALYTICS_PERSISTENCE_NAME,
  ANALYTICS_URL_QUERY_ALLOWLIST,
  getAnalyticsConfig,
  isAnalyticsAvailable,
  SUPPORTS_HANDOFF,
  type AnalyticsConfig,
} from './config'
import type { BrowserEvent, TrackArgs } from './events'
import { isPersistedIdentified, readHandoff, stripHandoffParams } from './handoff'
import { buildPosthogOptions } from './posthog-options'

/** The API path the Express proxy forwards to PostHog. */
export const ANALYTICS_PROXY_PATH = '/api/v1/collect'

/** posthog-js's three explicit consent states. */
export type AnalyticsConsent = 'granted' | 'denied' | 'pending'

/**
 * How the signed-in user reached the tenant they are on: as a member, or as
 * staff through platform access. Sent as the `tenant_access` super property
 * on tenant pages, so group insights can leave staff out.
 */
export type AnalyticsTenantAccess = 'member' | 'platform'

/** The super property that carries `AnalyticsTenantAccess` on tenant pages. */
export const TENANT_ACCESS_PROPERTY = 'tenant_access'

/** posthog-js's marker on an event sent cookieless (`required` mode, consent refused). */
const COOKIELESS_FLAG_PROPERTY = '$cookieless_mode'

/**
 * How long the event guard waits before identifying the signed-in user again
 * after something else changed the identity cookie. Long enough for this
 * app's own cross-tab messages (a sign-out broadcast, another tab's sign-in)
 * to land first, so the guard never fights a legitimate change.
 */
export const IDENTITY_REPAIR_DELAY_MS = 250

/** The channel on which this app's tabs announce the person each one identified. */
const IDENTITY_CHANNEL = 'analytics-identity'

/** How many identities announced by this app's other tabs are remembered. */
const MAX_SIBLING_IDENTITIES = 20

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

interface AppliedTenant {
  id: string
  access: AnalyticsTenantAccess
}

let status: 'idle' | 'loading' | 'ready' | 'inert' = 'idle'
let client: PostHogInterface | null = null
let queue: QueuedCommand[] = []
let activeConfig: AnalyticsConfig | null = null
/**
 * The tenant group the SDK carries now, kept in step with it: written only
 * inside a command, when the SDK call is made, so a queued call never
 * reads the state of a later one.
 */
let appliedTenant: AppliedTenant | null = null
/** The last tenant grouped since sign-in, kept across non-tenant pages so `tenant_switched` compares tenants. */
let lastTenantId: string | null = null
/**
 * The user this tab identified, while the SDK still holds that person. Set
 * after `identify`, cleared before every `reset`, so the event guard sees
 * only changes something else made.
 */
let signedInUserId: string | null = null
let isRepairScheduled = false
let identityRepair: ReturnType<typeof setTimeout> | null = null
/** Distinct ids this app's other tabs identified: a cookie change to one of them is theirs, not a website's. */
let siblingIdentities: string[] = []
/**
 * Set once another tab of this app identified someone else under this tab's
 * signed-in user. Every event is dropped until this tab signs out or in
 * again, and the SDK is never reset under the other tab's person.
 */
let isSuperseded = false
let identityChannel: BroadcastChannel | null = null
const consentListeners = new Set<() => void>()
const supersededListeners = new Set<() => void>()

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

/** Opens this tab's identity channel, once; a no-op without BroadcastChannel. */
function openIdentityChannel(): void {
  if (identityChannel || typeof BroadcastChannel === 'undefined') return
  identityChannel = new BroadcastChannel(IDENTITY_CHANNEL)
  identityChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; distinctId?: unknown } | null
    if (data?.type !== 'identified' || typeof data.distinctId !== 'string') return
    siblingIdentities = [
      ...siblingIdentities.filter((id) => id !== data.distinctId),
      data.distinctId,
    ].slice(-MAX_SIBLING_IDENTITIES)
  })
}

function announceIdentity(distinctId: string): void {
  try {
    identityChannel?.postMessage({ type: 'identified', distinctId })
  } catch {
    // Analytics never fails a user action.
  }
}

/** Marks this tab superseded by another tab's sign-in and tells the app, once. */
function supersede(): void {
  if (isSuperseded) return
  isSuperseded = true
  for (const listener of supersededListeners) listener()
}

function becomeInert(): void {
  status = 'inert'
  queue = []
}

/** The super properties on every browser event; `reset()` clears them, so they are set again after it. */
function registerSuperProperties(ph: PostHogInterface): void {
  ph.register({ app: ANALYTICS_APP, environment: activeConfig?.environment })
}

/** Puts the SDK's tenant group and `tenant_access` in line with `appliedTenant`. */
function applyTenant(ph: PostHogInterface): void {
  if (appliedTenant) {
    // Registered before group(), whose `$groupidentify` must already carry it.
    ph.register({ [TENANT_ACCESS_PROPERTY]: appliedTenant.access })
    ph.group('tenant', appliedTenant.id)
    return
  }
  const groups = ph.get_property('$groups') as Record<string, unknown> | undefined
  if (groups?.tenant !== undefined) ph.resetGroups()
  if (ph.get_property(TENANT_ACCESS_PROPERTY) !== undefined) {
    ph.unregister(TENANT_ACCESS_PROPERTY)
  }
}

/**
 * Starts the loaded SDK. The super properties are registered first, and any
 * tenant group a previous page load persisted is dropped: the tenant comes
 * from the route this load resolves, never from storage another tab wrote.
 */
function onLoaded(instance: PostHogInterface): void {
  client = instance
  status = 'ready'
  execute(registerSuperProperties, instance)
  execute(applyTenant, instance)
  const pending = queue
  queue = []
  for (const { command } of pending) execute(command, instance)
  notifyConsent()
}

/**
 * `reset()` also clears the super properties, the tenant group and
 * posthog-js's consent, so all three are put back after it: the next
 * person's events still say which app, environment and tenant page they come
 * from, and the browser's consent answer stands. Sign-out clears
 * `appliedTenant` before calling this.
 */
function resetKeepingConsent(ph: PostHogInterface): void {
  signedInUserId = null
  const consent = ph.get_explicit_consent_status()
  ph.reset()
  registerSuperProperties(ph)
  applyTenant(ph)
  if (consent === 'granted') ph.opt_in_capturing()
  if (consent === 'denied') ph.opt_out_capturing()
}

/**
 * Identifies `userId`, first resetting a different person this browser still
 * holds, and tells this app's other tabs it did.
 */
function applyIdentity(ph: PostHogInterface, userId: string): void {
  if (ph.get_property('$user_state') === 'identified' && ph.get_distinct_id() !== userId) {
    resetKeepingConsent(ph)
  }
  ph.identify(userId)
  signedInUserId = userId
  isSuperseded = false
  announceIdentity(userId)
}

/**
 * Puts back the super properties and tenant group something else cleared
 * under this tab (a reset by a sibling sharing the identity cookie). Runs in
 * a microtask, never inside the event that found the change, and at most
 * once per task.
 */
function scheduleRepair(): void {
  if (isRepairScheduled) return
  isRepairScheduled = true
  queueMicrotask(() => {
    isRepairScheduled = false
    run((ph) => {
      registerSuperProperties(ph)
      applyTenant(ph)
    })
  })
}

/**
 * Identifies the signed-in user again after something else changed the
 * identity cookie, `IDENTITY_REPAIR_DELAY_MS` later, and only if the change
 * still stands then and is foreign. A sign-out in this tab (another tab's
 * logout broadcast landing) cancels it. A change to a person another tab of
 * this app identified is that tab's legitimate sign-in: this tab is then
 * superseded instead, and the app signs it out, never fighting the other tab.
 * Only a foreign identity, such as one a website sharing the cookie set, is
 * repaired.
 */
function scheduleIdentityRepair(): void {
  if (identityRepair !== null) return
  identityRepair = setTimeout(() => {
    identityRepair = null
    run((ph) => {
      const userId = signedInUserId
      if (userId === null || isSuperseded) return
      const current = ph.get_distinct_id()
      if (current === userId) return
      if (siblingIdentities.includes(current)) {
        supersede()
        return
      }
      applyIdentity(ph, userId)
      registerSuperProperties(ph)
      applyTenant(ph)
    })
  }, IDENTITY_REPAIR_DELAY_MS)
}

/**
 * The event's app, environment, tenant group and `tenant_access` as this tab
 * set them, or null when they already are.
 */
function repairedProperties(properties: Record<string, unknown>): Record<string, unknown> | null {
  const environment = activeConfig?.environment
  const groups = (properties.$groups as Record<string, unknown> | undefined) ?? {}
  const tenant = appliedTenant
  const isRight =
    properties.app === ANALYTICS_APP &&
    properties.environment === environment &&
    groups.tenant === tenant?.id &&
    properties[TENANT_ACCESS_PROPERTY] === tenant?.access
  if (isRight) return null
  const otherGroups = { ...groups }
  delete otherGroups.tenant
  const repaired: Record<string, unknown> = { ...properties, app: ANALYTICS_APP, environment }
  delete repaired[TENANT_ACCESS_PROPERTY]
  delete repaired.$groups
  const nextGroups = tenant ? { ...otherGroups, tenant: tenant.id } : otherGroups
  if (Object.keys(nextGroups).length > 0) repaired.$groups = nextGroups
  if (tenant) repaired[TENANT_ACCESS_PROPERTY] = tenant.access
  return repaired
}

/**
 * Runs on every event before it is sanitised and sent. While a user is
 * signed in, an event carrying any other distinct id is dropped: a sibling
 * sharing the identity cookie re-attributed it. If another tab of this app
 * identified that person, this tab is superseded (see
 * `subscribeIdentitySuperseded`); otherwise the user is identified again
 * after `IDENTITY_REPAIR_DELAY_MS`. An event missing this tab's app,
 * environment or tenant group (a sibling's reset clears them) gets them back,
 * and the SDK is repaired for the next event. Cookieless events carry a
 * placeholder id and are left alone, as is replay (`$snapshot`), which
 * carries no super properties.
 * @param event - The event posthog-js is about to send.
 * @returns The event to send, or null to drop it.
 */
function guardEvent(event: CaptureResult): CaptureResult | null {
  const properties = (event.properties ?? {}) as Record<string, unknown>
  if (properties[COOKIELESS_FLAG_PROPERTY] === true) return event
  if (isSuperseded) return null
  if (signedInUserId !== null && properties.distinct_id !== signedInUserId) {
    if (
      typeof properties.distinct_id === 'string' &&
      siblingIdentities.includes(properties.distinct_id)
    ) {
      supersede()
    } else {
      scheduleIdentityRepair()
    }
    return null
  }
  if (event.event === '$snapshot') return event
  const repaired = repairedProperties(properties)
  if (repaired === null) return event
  scheduleRepair()
  return { ...event, properties: repaired }
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
  openIdentityChannel()
  try {
    const key = config.key
    const handoff =
      SUPPORTS_HANDOFF && key !== undefined && config.consentMode === 'opt_out'
        ? readHandoff(
            window.location,
            document.referrer,
            config.handoffOrigins,
            isPersistedIdentified(key, ANALYTICS_PERSISTENCE_NAME)
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
        persistenceName: ANALYTICS_PERSISTENCE_NAME,
        crossSubdomainCookie: ANALYTICS_CROSS_SUBDOMAIN_COOKIE,
        bootstrap: handoff.bootstrap,
        guardEvent,
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
 * Captures a `$pageview` for the current location. posthog-js's own history
 * pageviews are off: the router calls this once a route has resolved and
 * its tenant group is set, so a pageview never carries the previous page's
 * tenant.
 */
export function capturePageview(): void {
  run((ph) => ph.capture('$pageview', {}), true)
}

/**
 * Identifies the signed-in user by id alone: person properties are set by the
 * server, where a browser cannot forge them. A different person already
 * identified in this browser is reset first, so the new user's events never
 * carry the old distinct id.
 * @param userId - The API's user id.
 */
export function identifyUser(userId: string): void {
  run((ph) => applyIdentity(ph, userId))
}

/**
 * Forgets a person this browser still holds when nobody is signed in: a
 * session restore that ended with no user, so an earlier visitor's identity
 * does not carry the next visitor's pageviews, replay and session header.
 * Does nothing for an anonymous browser, a handed-off visitor included.
 */
export function forgetStaleIdentity(): void {
  run((ph) => {
    if (ph.get_property('$user_state') === 'identified') resetKeepingConsent(ph)
  })
}

/**
 * Puts the following events in the tenant's group, with `tenant_access`
 * saying how the user reached it. Moving to a different tenant than the last
 * one grouped since sign-in also sends `tenant_switched`, even with other
 * pages in between; the same tenant again does nothing. Group properties are
 * set by the server only.
 * @param tenantId - The tenant whose page this is.
 * @param access - `platform` when staff reached it through platform access.
 */
export function setTenantGroup(tenantId: string, access: AnalyticsTenantAccess = 'member'): void {
  run((ph) => {
    if (appliedTenant?.id === tenantId && appliedTenant.access === access) return
    const isSwitch = lastTenantId !== null && lastTenantId !== tenantId
    appliedTenant = { id: tenantId, access }
    lastTenantId = tenantId
    applyTenant(ph)
    if (isSwitch) ph.capture('tenant_switched' satisfies BrowserEvent, {})
  })
}

/** Takes the following events out of any tenant group: a page that is not a tenant's. */
export function clearTenantGroup(): void {
  run((ph) => {
    if (appliedTenant === null) return
    appliedTenant = null
    applyTenant(ph)
  })
}

/**
 * Forgets the person and the tenant: sign-out, forced or chosen. The consent
 * answer survives. A tab superseded by another tab's sign-in forgets its own
 * state only: resetting the SDK would sign that other tab's person out of
 * the shared identity too.
 */
export function resetAnalytics(): void {
  run((ph) => {
    appliedTenant = null
    lastTenantId = null
    if (identityRepair !== null) {
      clearTimeout(identityRepair)
      identityRepair = null
    }
    if (isSuperseded) {
      isSuperseded = false
      signedInUserId = null
      registerSuperProperties(ph)
      applyTenant(ph)
      return
    }
    resetKeepingConsent(ph)
  })
}

/**
 * Subscribes to this tab being superseded: another tab of this app signed a
 * different person in under this tab's signed-in user, on the shared session
 * cookie. Until the tab signs out or in again its events are dropped; the
 * app should end its session (the next refresh returns the other person).
 * @param listener - Called once per supersession.
 * @returns The unsubscribe.
 */
export function subscribeIdentitySuperseded(listener: () => void): () => void {
  supersededListeners.add(listener)
  return () => {
    supersededListeners.delete(listener)
  }
}

/**
 * Applies the signed-in user's own preference. Opting out stops capture in
 * every mode. Opting back in resumes capture in `opt_out` mode only: in
 * `required` mode consent is the banner's answer, not the profile's. Opting
 * back in on a loaded page captures that page's `$pageview`, which was
 * dropped while opted out.
 * @param isOptedOut - The profile's `analyticsOptOut`.
 */
export function setAnalyticsOptOut(isOptedOut: boolean): void {
  // Queued before load, the router's own pageview follows and must not be doubled.
  const isOnScreen = status === 'ready'
  run((ph) => {
    if (isOptedOut) {
      if (!ph.has_opted_out_capturing()) ph.opt_out_capturing()
    } else if (activeConfig?.consentMode === 'opt_out' && ph.has_opted_out_capturing()) {
      ph.opt_in_capturing()
      if (isOnScreen) ph.capture('$pageview', {})
    }
    notifyConsent()
  })
}

/**
 * The banner's accept, and the profile switch turned on in `required` mode.
 * A signed-in user is identified again before `$opt_in` is captured:
 * leaving cookieless mode gives posthog-js a fresh anonymous id. The page on
 * screen gets its `$pageview` when consent was pending: every pageview the
 * router captured until now was dropped, and posthog-js's own are off.
 */
export function grantAnalyticsConsent(): void {
  run((ph) => {
    const wasPending = ph.get_explicit_consent_status() === 'pending'
    // PostHogInterface types it with no options; the PostHog class it is takes them.
    ;(ph as PostHog).opt_in_capturing({ captureEventName: false })
    const userId = signedInUserId
    if (userId !== null && ph.get_distinct_id() !== userId) applyIdentity(ph, userId)
    registerSuperProperties(ph)
    applyTenant(ph)
    ph.capture('$opt_in', {}, { send_instantly: true })
    if (wasPending) ph.capture('$pageview', {})
    notifyConsent()
  })
}

/**
 * The banner's decline. The page on screen gets its `$pageview` when consent
 * was pending, sent cookieless as every later one is.
 */
export function denyAnalyticsConsent(): void {
  run((ph) => {
    const wasPending = ph.get_explicit_consent_status() === 'pending'
    ph.opt_out_capturing()
    if (wasPending) ph.capture('$pageview', {})
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

/**
 * The replay session id for a request, only when the SDK's person is the one
 * making it: PostHog is anonymous, or its distinct id is `userId`. A browser
 * still holding someone else (a stale or foreign identity) sends none, so the
 * server never links this request to that person's replay.
 * @param userId - The signed-in user's id, or null when nobody is signed in.
 * @returns See `getAnalyticsSessionId`; undefined for a foreign identity too.
 */
export function getAnalyticsSessionIdFor(userId: string | null): string | undefined {
  if (status !== 'ready' || !client) return undefined
  try {
    if (
      client.get_property('$user_state') === 'identified' &&
      client.get_distinct_id() !== userId
    ) {
      return undefined
    }
  } catch {
    return undefined
  }
  return getAnalyticsSessionId()
}

/** Test-only: forget the SDK, the queue, the identity, the tenant and every listener. */
export function resetAnalyticsForTests(): void {
  status = 'idle'
  client = null
  queue = []
  activeConfig = null
  appliedTenant = null
  lastTenantId = null
  signedInUserId = null
  isRepairScheduled = false
  if (identityRepair !== null) clearTimeout(identityRepair)
  identityRepair = null
  siblingIdentities = []
  isSuperseded = false
  identityChannel?.close()
  identityChannel = null
  consentListeners.clear()
  supersededListeners.clear()
}
