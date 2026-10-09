/**
 * @file The lazy half of error tracking: it filters a noted error, builds a
 * PostHog `$exception` from it with `@posthog/core`, scrubs and throttles it,
 * attaches an identity only when analytics consent allows, and sends it
 * through the API's `/api/v1/collect` proxy. It never throws.
 */
import {
  chromeStackLineParser,
  createStackParser,
  DOMExceptionCoercer,
  ErrorCoercer,
  ErrorEventCoercer,
  ErrorPropertiesBuilder,
  geckoStackLineParser,
  ObjectCoercer,
  PrimitiveCoercer,
  PromiseRejectionEventCoercer,
  StringCoercer,
  type Exception,
  type StackFrame,
} from '@posthog/core/error-tracking'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import { isAxiosError } from 'axios'
import { isChunkLoadError } from '@/lib/chunk-load-error'
import {
  ANALYTICS_PROXY_PATH,
  getAnalyticsConfig,
  identityEpoch,
  isAnalyticsAvailable,
  whenAnalyticsSettled,
  type AnalyticsIdentity,
} from '@/observability/analytics'
import { ANALYTICS_APP, ANALYTICS_URL_QUERY_ALLOWLIST } from '@/observability/analytics/config'
import { sanitizeUrl } from '@/observability/analytics/url-sanitizer'
import { currentRouteId, type ErrorOrigin } from './listen'
import { scrubText } from './scrub'

/** How long an exception waits for analytics to settle before it is sent anonymous. */
export const SETTLE_CAP_MS = 10_000

/** Events per fingerprint in one page life. */
export const FINGERPRINT_LIMIT = 5

/** Events in one page life; past it nothing more is built. */
export const PAGE_LIMIT = 30

/** Events per request. */
export const BATCH_SIZE = 10

/** How long an event waits for others to share its request. */
export const BATCH_WINDOW_MS = 2_000

/** The one retry of a batch that failed on the network or with a 5xx. */
export const RETRY_DELAY_MS = 5_000

/** Exceptions kept from a `cause` chain, the thrown one first. */
export const CAUSE_DEPTH = 5

/** The most serialized bytes in one request: under the 64 KiB that `keepalive` fetches and beacons share. */
export const BATCH_MAX_BYTES = 60 * 1024

/** The most `keepalive` request bytes a page may have in flight at once; Chromium refuses a keepalive fetch past it. */
export const KEEPALIVE_QUOTA_BYTES = 64 * 1024

/** An error handed over later than this after it was noted is sent anonymous: its identity is no longer knowable. */
export const STALE_ERROR_MS = 10_000

/** What `fetch` throws for a request that never got a response, in Chromium, Firefox and Safari. */
const NETWORK_FAILURE_MESSAGES = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
]

/** A browser `$exception` as `/batch/` takes it. */
export interface ExceptionEvent {
  event: '$exception'
  uuid: string
  timestamp: string
  distinct_id: string
  properties: Record<string, unknown>
}

type PendingEvent = Omit<ExceptionEvent, 'distinct_id'>

let builder: ErrorPropertiesBuilder | undefined
const fingerprintCounts = new Map<string, number>()
let accepted = 0
let settleGate: Promise<void> | undefined
/** Set once analytics has settled; until then, an event built after the settle cap is anonymous without asking again. */
let hasAnalyticsSettled = false
let queue: ExceptionEvent[] = []
/** Built events still waiting for their identity; `pagehide` beacons them anonymous. */
const awaitingIdentity = new Set<PendingEvent>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
const retrying = new Map<ExceptionEvent[], ReturnType<typeof setTimeout>>()
/** The bytes of this reporter's `keepalive` requests still in flight. */
let keepaliveBytesInFlight = 0
let isPageHideInstalled = false

function messageOf(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (typeof input !== 'object' || input === null) return undefined
  const message = (input as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

/**
 * Whether a noted error is dropped before anything is built: an API or
 * network failure (the server owns its 5xx, and the network is not a bug),
 * an abort, ResizeObserver noise, or a cross-origin `Script error.` with no
 * stack.
 * @param input - The noted error, as received.
 * @returns True to drop it.
 */
export function isIgnoredError(input: unknown): boolean {
  if (isAxiosError(input)) return true
  if (typeof input !== 'object' && typeof input !== 'string') return false
  const name = typeof input === 'object' && input !== null ? (input as { name?: unknown }).name : ''
  if (name === 'AbortError' || name === 'CanceledError') return true
  const message = messageOf(input)
  if (message === undefined) return false
  if (message.startsWith('ResizeObserver loop')) return true
  if (input instanceof TypeError && NETWORK_FAILURE_MESSAGES.includes(message)) return true
  return message === 'Script error.' && !(input instanceof Error && input.stack)
}

/**
 * Whether a frame is this app's code: a file served from this origin under
 * `/assets/` (a production build) or `/src/` (the dev server). An extension's
 * or another origin's frame never is.
 * @param filename - The frame's URL.
 * @param origin - Defaults to this page's origin.
 * @returns True for the app's own frames.
 */
export function isAppFrame(filename: string | undefined, origin = location.origin): boolean {
  if (!filename) return false
  try {
    const url = new URL(filename)
    return url.origin === origin && /^\/(assets|src)\//.test(url.pathname)
  } catch {
    return false
  }
}

function scrubFrame(frame: StackFrame): StackFrame {
  return {
    ...frame,
    in_app: isAppFrame(frame.filename),
    ...(frame.filename === undefined ? {} : { filename: scrubText(frame.filename) }),
    ...(frame.function === undefined ? {} : { function: scrubText(frame.function) }),
  }
}

/**
 * The builder's exception list cut to `CAUSE_DEPTH`, with `in_app`
 * recomputed for every frame and every type, value, filename and function
 * scrubbed.
 * @param list - `$exception_list` as the builder returned it.
 * @returns The list to send.
 */
export function prepareExceptionList(list: Exception[]): Exception[] {
  return list.slice(0, CAUSE_DEPTH).map((exception) => ({
    ...exception,
    ...(exception.type === undefined ? {} : { type: scrubText(exception.type) }),
    ...(exception.value === undefined ? {} : { value: scrubText(exception.value) }),
    ...(exception.stacktrace
      ? {
          stacktrace: {
            ...exception.stacktrace,
            frames: exception.stacktrace.frames?.map(scrubFrame),
          },
        }
      : {}),
  }))
}

/**
 * What the throttle counts as one error: the thrown exception's type and its
 * innermost in-app frame, or its type and scrubbed value when it has none.
 * @param list - A prepared exception list.
 * @returns The fingerprint.
 */
export function fingerprintOf(list: Exception[]): string {
  const [first] = list
  const frame = first?.stacktrace?.frames?.findLast((candidate) => candidate.in_app)
  const where = frame
    ? `${frame.filename ?? ''}:${frame.function ?? ''}:${String(frame.lineno ?? '')}`
    : (first?.value ?? '')
  return `${first?.type ?? 'Error'}|${where}`
}

/**
 * A sanitised URL with its path scrubbed (a user's email in a path segment
 * becomes `[email]`) and its query kept as `sanitizeUrl` left it, since the
 * query rule would turn the allowlisted keys into `?[query]`.
 * @param url - The result of `sanitizeUrl`.
 * @returns The URL to send.
 */
function scrubUrl(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return scrubText(url)
  return `${scrubText(url.slice(0, queryStart))}${url.slice(queryStart)}`
}

function build(error: unknown, handled: boolean): Exception[] {
  builder ??= new ErrorPropertiesBuilder(
    [
      new DOMExceptionCoercer(),
      new ErrorEventCoercer(),
      new ErrorCoercer(),
      new PromiseRejectionEventCoercer(),
      new ObjectCoercer(),
      new StringCoercer(),
      new PrimitiveCoercer(),
    ],
    createStackParser('web:javascript', chromeStackLineParser, geckoStackLineParser)
  )
  return builder.buildFromUnknown(error, { mechanism: { type: 'generic', handled } })
    .$exception_list
}

/**
 * The identity for an event built now. The first call waits for analytics
 * to settle, at most `SETTLE_CAP_MS`; once that wait is over, later calls
 * read the identity without waiting, and get null while analytics is still
 * unsettled. Only the first call asks analytics to tell it when it settles,
 * so errors after the cap leave nothing waiting on a load that may never end.
 */
function resolveIdentity(): Promise<AnalyticsIdentity | null> {
  settleGate ??= new Promise((resolve) => {
    const cap = setTimeout(resolve, SETTLE_CAP_MS)
    void whenAnalyticsSettled().then(() => {
      hasAnalyticsSettled = true
      clearTimeout(cap)
      resolve()
    })
  })
  return settleGate.then(() => (hasAnalyticsSettled ? whenAnalyticsSettled() : null))
}

/**
 * The event with its identity: the consented person, session, window and
 * tenant group; or, without consent, a fresh distinct id of its own and no
 * person profile.
 * @param event - The built event.
 * @param identity - From `whenAnalyticsSettled`, or null.
 * @returns The event to send.
 */
export function withIdentity(
  event: PendingEvent,
  identity: AnalyticsIdentity | null
): ExceptionEvent {
  if (identity === null) {
    return {
      ...event,
      distinct_id: uuidv7(),
      properties: { ...event.properties, $process_person_profile: false },
    }
  }
  return {
    ...event,
    distinct_id: identity.distinctId,
    properties: {
      ...event.properties,
      ...(identity.sessionId ? { $session_id: identity.sessionId } : {}),
      ...(identity.windowId ? { $window_id: identity.windowId } : {}),
      ...(identity.groups ? { $groups: identity.groups } : {}),
    },
  }
}

function batchUrl(): string {
  return `${location.origin}${ANALYTICS_PROXY_PATH}/batch/`
}

function batchBody(batch: ExceptionEvent[]): string {
  return JSON.stringify({ api_key: getAnalyticsConfig().key, batch })
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Takes the next request's events off the front of a list: at most
 * `BATCH_SIZE`, and at most `BATCH_MAX_BYTES` once serialized (an event too
 * big alone still goes alone).
 */
function takeBatch(events: ExceptionEvent[]): ExceptionEvent[] {
  let bytes = byteLength(batchBody([]))
  let count = 0
  for (const event of events.slice(0, BATCH_SIZE)) {
    bytes += byteLength(JSON.stringify(event)) + 1
    if (count > 0 && bytes > BATCH_MAX_BYTES) break
    count += 1
  }
  return events.splice(0, count)
}

/**
 * Posts one batch, retrying once after a network failure or a 5xx. The
 * request asks for `keepalive`, so it outlives the page, only while it fits
 * in what is left of `KEEPALIVE_QUOTA_BYTES` beside the reporter's other
 * keepalive requests in flight; otherwise it goes as a plain request.
 * @param batch - The events to send.
 * @param canRetry - False for the retry itself.
 */
async function send(batch: ExceptionEvent[], canRetry: boolean): Promise<void> {
  let keepaliveBytes = 0
  try {
    const body = batchBody(batch)
    const bytes = byteLength(body)
    if (bytes <= BATCH_MAX_BYTES && keepaliveBytesInFlight + bytes <= KEEPALIVE_QUOTA_BYTES) {
      keepaliveBytes = bytes
      keepaliveBytesInFlight += bytes
    }
    const response = await fetch(batchUrl(), {
      method: 'POST',
      ...(keepaliveBytes > 0 ? { keepalive: true } : {}),
      body,
    })
    if (response.status < 500) return
  } catch {
    // A network failure: retried once below, like a 5xx.
  } finally {
    keepaliveBytesInFlight -= keepaliveBytes
  }
  if (!canRetry) return
  retrying.set(
    batch,
    setTimeout(() => {
      retrying.delete(batch)
      void send(batch, false)
    }, RETRY_DELAY_MS)
  )
}

function flush(): void {
  if (flushTimer !== undefined) clearTimeout(flushTimer)
  flushTimer = undefined
  while (queue.length > 0) void send(takeBatch(queue), true)
}

function enqueue(event: ExceptionEvent): void {
  queue.push(event)
  if (queue.length >= BATCH_SIZE) flush()
  else flushTimer ??= setTimeout(flush, BATCH_WINDOW_MS)
}

/**
 * On `pagehide`, everything not yet sent, every batch waiting to retry, and
 * every event still waiting for its identity (anonymous, as its identity is
 * not known yet) goes by beacon.
 */
function sendOnPageHide(): void {
  // A listener that throws reaches window `error`, which would report the reporter itself.
  try {
    const unsent = queue.splice(0)
    for (const event of awaitingIdentity) unsent.push(withIdentity(event, null))
    awaitingIdentity.clear()
    for (const [batch, timer] of retrying) {
      clearTimeout(timer)
      unsent.push(...batch)
    }
    retrying.clear()
    if (flushTimer !== undefined) clearTimeout(flushTimer)
    flushTimer = undefined
    while (unsent.length > 0) {
      const body = batchBody(takeBatch(unsent))
      // Typed, or the beacon goes as text/plain.
      navigator.sendBeacon(batchUrl(), new Blob([body], { type: 'application/json' }))
    }
  } catch {
    // The page is going away: there is nothing left to try.
  }
}

/**
 * Filters, builds, scrubs and throttles one noted error, then queues it to
 * send once its identity is known. Does nothing without a PostHog key or in
 * consent mode `off`. Never throws.
 * @param error - The noted error.
 * @param origin - Where it was noticed.
 * @param handled - True when the app already shows the user an error screen.
 * @param notedAt - When it was noted, `Date.now()` by default; a buffered error
 *   carries its own. Older than `STALE_ERROR_MS`, it is sent anonymous.
 * @param notedEpoch - `identityEpoch()` when it was noted, read now by default;
 *   if the epoch has changed by the time analytics settles, it is sent anonymous.
 */
export function report(
  error: unknown,
  origin: ErrorOrigin,
  handled: boolean,
  notedAt = Date.now(),
  notedEpoch = identityEpoch()
): void {
  try {
    const isStale = Date.now() - notedAt > STALE_ERROR_MS
    if (!isAnalyticsAvailable() || accepted >= PAGE_LIMIT || isIgnoredError(error)) return
    if (!isPageHideInstalled) {
      isPageHideInstalled = true
      addEventListener('pagehide', sendOnPageHide)
    }
    const isChunkLoad = origin === 'chunk_load' || isChunkLoadError(error)
    const list = prepareExceptionList(build(error, handled || isChunkLoad))
    const hasAppFrame = list.some((exception) =>
      exception.stacktrace?.frames?.some((frame) => frame.in_app)
    )
    // A failed chunk fetch has no frames of its own; it is kept because it signals deploy skew.
    if (!hasAppFrame && !isChunkLoad) return
    const fingerprint = fingerprintOf(list)
    const count = fingerprintCounts.get(fingerprint) ?? 0
    if (count >= FINGERPRINT_LIMIT) return
    fingerprintCounts.set(fingerprint, count + 1)
    accepted += 1
    // A replayed error's route and URL are the page's now, not its own.
    const routeId = isStale ? undefined : currentRouteId()
    const event: PendingEvent = {
      event: '$exception',
      uuid: uuidv7(),
      timestamp: new Date(notedAt).toISOString(),
      properties: {
        $exception_list: list,
        $exception_level: 'error',
        app: ANALYTICS_APP,
        origin: isChunkLoad ? 'chunk_load' : origin,
        release: __APP_RELEASE__,
        environment: getAnalyticsConfig().environment,
        ...(routeId === undefined ? {} : { route_id: routeId }),
        ...(isStale
          ? {}
          : { $current_url: scrubUrl(sanitizeUrl(location.href, ANALYTICS_URL_QUERY_ALLOWLIST)) }),
      },
    }
    awaitingIdentity.add(event)
    // The identity is read when it settles, so it counts only if nothing changed it since this error.
    void resolveIdentity().then(
      (identity) => {
        // Already beaconed on pagehide.
        if (!awaitingIdentity.delete(event)) return
        const isOwn = !isStale && identityEpoch() === notedEpoch
        enqueue(withIdentity(event, isOwn ? identity : null))
      },
      () => {
        if (awaitingIdentity.delete(event)) enqueue(withIdentity(event, null))
      }
    )
  } catch {
    // Error tracking never fails the page, and never reports itself.
  }
}

/** Test-only: forget the throttle, the queue, the settle wait and the timers. */
export function resetReporterForTests(): void {
  fingerprintCounts.clear()
  accepted = 0
  settleGate = undefined
  hasAnalyticsSettled = false
  queue = []
  awaitingIdentity.clear()
  if (flushTimer !== undefined) clearTimeout(flushTimer)
  flushTimer = undefined
  for (const timer of retrying.values()) clearTimeout(timer)
  retrying.clear()
  keepaliveBytesInFlight = 0
  if (isPageHideInstalled) removeEventListener('pagehide', sendOnPageHide)
  isPageHideInstalled = false
}
