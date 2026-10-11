/**
 * @file The entry-chunk half of error tracking: it notes raw errors, buffers
 * a few, and loads the lazy reporter (`report.ts`) on the first error or when
 * the browser is idle. Nothing here builds, filters or sends an event.
 */
import { identityEpoch } from '@/observability/identity-epoch'

/** Where an error was noticed; sent as the event's `origin`. */
export type ErrorOrigin = 'window' | 'rejection' | 'react' | 'router' | 'chunk_load'

/** The reporter chunk's entry point; `notedAt` and `notedEpoch` are set for an error that was buffered. */
type Reporter = (
  error: unknown,
  origin: ErrorOrigin,
  handled: boolean,
  notedAt?: number,
  notedEpoch?: number
) => void

/** Errors held until the reporter has loaded; later ones are dropped. */
export const ERROR_BUFFER_LIMIT = 20

/** The longest the reporter's load waits after install: the idle callback's timeout, or the `setTimeout` delay where that is missing. */
export const IDLE_LOAD_FALLBACK_MS = 3000

/**
 * How long a second error with the same name, message and stack counts as a
 * re-throw of the crash it repeats. A route that crashes again throws a new
 * error object each time, so the `seen` set alone would miss it.
 */
export const RETHROW_WINDOW_MS = 1000

const buffer: [unknown, ErrorOrigin, boolean, number, number][] = []
const seen = new WeakSet<object>()
/** When each recently noted name, message and stack was first noted. */
const recent = new Map<string, number>()
let reporter: Reporter | undefined
let isLoading = false
let isInstalled = false
let readRouteId: (() => string | undefined) | undefined

/** Loads the reporter chunk once and hands it the buffered errors; a failed load can be retried. */
function load(): void {
  if (reporter || isLoading) return
  isLoading = true
  import('./report').then(
    (module) => {
      reporter = module.report
      for (const [error, origin, handled, notedAt, notedEpoch] of buffer.splice(0)) {
        reporter(error, origin, handled, notedAt, notedEpoch)
      }
    },
    () => {
      isLoading = false
    }
  )
}

/**
 * Whether an error repeats one noted less than `RETHROW_WINDOW_MS` ago: the
 * same name, message and stack. Records it when it does not. An error without
 * a stack never repeats one.
 */
function isRethrow(error: object): boolean {
  const { name, message, stack } = error as { name?: unknown; message?: unknown; stack?: unknown }
  if (typeof stack !== 'string' || stack === '') return false
  const now = Date.now()
  for (const [key, at] of recent) if (now - at >= RETHROW_WINDOW_MS) recent.delete(key)
  const key = `${String(name)}\n${String(message)}\n${stack}`
  if (recent.has(key)) return true
  recent.set(key, now)
  return false
}

/**
 * Hands one error to the reporter, or buffers it until the reporter loads.
 * An error object is noted once, whichever source sees it first, and so is a
 * re-throw of the same crash (see `RETHROW_WINDOW_MS`); an error that is not
 * an object is not deduplicated. Never throws.
 * @param error - What was thrown or rejected, as received.
 * @param origin - Where it was noticed.
 * @param handled - True when the app already shows the user an error screen.
 */
export function noteError(error: unknown, origin: ErrorOrigin, handled: boolean): void {
  try {
    if (typeof error === 'object' && error !== null) {
      if (seen.has(error)) return
      seen.add(error)
      if (isRethrow(error)) return
    }
    if (reporter) {
      reporter(error, origin, handled)
      return
    }
    if (buffer.length < ERROR_BUFFER_LIMIT)
      buffer.push([error, origin, handled, Date.now(), identityEpoch()])
    load()
  } catch {
    // Error tracking never fails the page.
  }
}

/**
 * The window `error` and `unhandledrejection` listeners, and the idle-time
 * load of the reporter. Idempotent.
 */
export function installErrorListeners(): void {
  if (isInstalled) return
  isInstalled = true
  addEventListener('error', (event) => {
    noteError(event.error ?? event, 'window', false)
  })
  addEventListener('unhandledrejection', (event) => {
    noteError(event.reason, 'rejection', false)
  })
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(load, { timeout: IDLE_LOAD_FALLBACK_MS })
  } else {
    setTimeout(load, IDLE_LOAD_FALLBACK_MS)
  }
}

/** React 19 root options for `createRoot`: every error React catches or fails to catch is noted, then logged with `console.error`. */
export const rootErrorOptions = {
  onUncaughtError: (error: unknown): void => {
    noteError(error, 'react', false)
    console.error(error)
  },
  onCaughtError: (error: unknown): void => {
    noteError(error, 'react', true)
    console.error(error)
  },
}

/**
 * Tells the reporter how to read the current route's id. The router module
 * calls it once; the reporter never imports the router, so it still loads
 * when the router's own module failed.
 * @param read - Returns the deepest matched route's `routeId`.
 */
export function setErrorRouteSource(read: () => string | undefined): void {
  readRouteId = read
}

/**
 * The current route's id, as `setErrorRouteSource` reads it.
 * @returns Undefined before the router registered, or when reading it throws.
 */
export function currentRouteId(): string | undefined {
  try {
    return readRouteId?.()
  } catch {
    return undefined
  }
}

/** Test-only: forget the buffer, the reporter and its loading flag, the route source and the recent re-throw keys. */
export function resetErrorListenForTests(): void {
  buffer.length = 0
  recent.clear()
  reporter = undefined
  isLoading = false
  readRouteId = undefined
}
