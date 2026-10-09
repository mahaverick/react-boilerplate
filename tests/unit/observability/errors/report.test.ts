import { AxiosError, AxiosHeaders, CanceledError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  identifyUser,
  resetAnalytics,
  setTenantGroup,
  whenAnalyticsSettled,
  type AnalyticsIdentity,
} from '@/observability/analytics'
import { resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { ANALYTICS_APP } from '@/observability/analytics/config'
import { resetErrorListenForTests, setErrorRouteSource } from '@/observability/errors/listen'
import {
  BATCH_MAX_BYTES,
  BATCH_SIZE,
  BATCH_WINDOW_MS,
  CAUSE_DEPTH,
  FINGERPRINT_LIMIT,
  fingerprintOf,
  isAppFrame,
  isIgnoredError,
  KEEPALIVE_QUOTA_BYTES,
  PAGE_LIMIT,
  report,
  resetReporterForTests,
  RETRY_DELAY_MS,
  SETTLE_CAP_MS,
  STALE_ERROR_MS,
  type ExceptionEvent,
} from '@/observability/errors/report'

const KEY = 'phc_test_key_not_real'
const config = vi.hoisted(() => ({
  isAvailable: true,
}))

vi.mock('@/observability/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/analytics')>()),
  whenAnalyticsSettled: vi.fn(),
  isAnalyticsAvailable: () => config.isAvailable,
  getAnalyticsConfig: () => ({
    key: 'phc_test_key_not_real',
    uiHost: 'https://us.posthog.com',
    consentMode: 'opt_out',
    handoffOrigins: [],
    environment: 'test',
  }),
}))

const settled = vi.mocked(whenAnalyticsSettled)
const fetchMock = vi.fn<typeof fetch>()
const beacon = vi.fn<(url: string, body: Blob) => boolean>()

const CONSENTED: AnalyticsIdentity = {
  distinctId: 'user-a',
  sessionId: 'session-1',
  windowId: 'window-1',
  groups: { tenant: 'tenant-1' },
}

/** An error whose stack names this app's bundle, as a production build's does. */
function appError(message: string, at = 'renderWidget', line = 1): Error {
  const error = new TypeError(message)
  error.stack = `TypeError: ${message}\n    at ${at} (${location.origin}/assets/index-abc123.js:${String(line)}:200)\n    at outer (${location.origin}/assets/index-abc123.js:9:10)`
  return error
}

/** An error with a 50-frame stack and a cause with another, each frame unique to `index`. */
function deepError(index: number): Error {
  const frames = (prefix: string) =>
    Array.from(
      { length: 50 },
      (_unused, frame) =>
        `    at ${prefix}${String(index)}x${String(frame)} (${location.origin}/assets/index-abc123.js:${String(frame + 1)}:200)`
    ).join('\n')
  const cause = new TypeError(`cause ${String(index)}`)
  cause.stack = `TypeError: cause ${String(index)}\n${frames('inner')}`
  const error = new TypeError(`deep ${String(index)}`, { cause })
  error.stack = `TypeError: deep ${String(index)}\n${frames('outer')}`
  return error
}

/** A fetch call's body, which the reporter always sends as a string. */
function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/** Every event sent by fetch so far, from the request bodies. */
function sentEvents(): ExceptionEvent[] {
  return fetchMock.mock.calls.flatMap(([, init]) => {
    const body = JSON.parse(bodyOf(init)) as { api_key: string; batch: ExceptionEvent[] }
    return body.batch
  })
}

/** Lets identity resolution and the batch window run. */
async function drain(): Promise<void> {
  await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  resetReporterForTests()
  resetErrorListenForTests()
  resetAnalyticsForTests()
  config.isAvailable = true
  settled.mockReset()
  settled.mockResolvedValue(CONSENTED)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  beacon.mockReset()
  beacon.mockReturnValue(true)
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  resetReporterForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('report', () => {
  it('sends a consented crash with its identity, route, release and a sanitised URL', async () => {
    setErrorRouteSource(() => '/_app/tenants/$slug/')
    window.history.replaceState(null, '', '/tenants/acme?tab=members&token=secret-value')
    report(appError('x.trim is not a function'), 'react', true)
    await drain()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${location.origin}/api/v1/collect/batch/`)
    expect(init).toMatchObject({ method: 'POST', keepalive: true })
    expect(JSON.parse(bodyOf(init))).toMatchObject({ api_key: KEY })
    const [event] = sentEvents()
    expect(event).toMatchObject({
      event: '$exception',
      distinct_id: 'user-a',
      properties: {
        $exception_level: 'error',
        app: ANALYTICS_APP,
        origin: 'react',
        release: 'test',
        environment: 'test',
        route_id: '/_app/tenants/$slug/',
        $current_url: `${location.origin}/tenants/acme?tab=members`,
        $session_id: 'session-1',
        $window_id: 'window-1',
        $groups: { tenant: 'tenant-1' },
      },
    })
    expect(event?.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    expect(event?.properties).not.toHaveProperty('$process_person_profile')
    const [exception] = event?.properties.$exception_list as {
      type: string
      value: string
      mechanism: { handled: boolean }
      stacktrace: { frames: { platform: string; in_app: boolean; function: string }[] }
    }[]
    expect(exception).toMatchObject({
      type: 'TypeError',
      value: 'x.trim is not a function',
      mechanism: { handled: true },
    })
    expect(exception?.stacktrace.frames.at(-1)).toMatchObject({
      platform: 'web:javascript',
      in_app: true,
      function: 'renderWidget',
    })
  })

  it('sends an anonymous crash without consent: a fresh distinct id per event, no session, no person', async () => {
    settled.mockResolvedValue(null)
    report(appError('first'), 'window', false)
    report(appError('second', 'other'), 'window', false)
    await drain()

    const events = sentEvents()
    expect(events).toHaveLength(2)
    expect(events[0]?.distinct_id).not.toBe(events[1]?.distinct_id)
    for (const event of events) {
      expect(event.properties.$process_person_profile).toBe(false)
      expect(event.properties).not.toHaveProperty('$session_id')
      expect(event.properties).not.toHaveProperty('$window_id')
      expect(event.properties).not.toHaveProperty('$groups')
    }
  })

  it('sends anonymous after the settle cap when analytics never settles, and stops waiting after', async () => {
    settled.mockReturnValue(new Promise(() => {}))
    report(appError('early'), 'window', false)
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1 + BATCH_WINDOW_MS)
    expect(sentEvents()[0]?.properties.$process_person_profile).toBe(false)

    report(appError('later', 'other'), 'window', false)
    await drain()
    expect(sentEvents()).toHaveLength(2)
  })

  it('sends the consented identity when nothing changed it before analytics settled', async () => {
    let settle: (identity: AnalyticsIdentity | null) => void = () => {}
    settled.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    report(appError('before settle'), 'window', false)
    settle(CONSENTED)
    await drain()
    expect(sentEvents()[0]?.distinct_id).toBe('user-a')
  })

  it.each([
    ['the tenant was switched', () => setTenantGroup('tenant-2')],
    [
      'the user logged out and in again',
      () => {
        resetAnalytics()
        identifyUser('user-b')
      },
    ],
  ])('sends anonymous when %s before analytics settled', async (_label, change) => {
    let settle: (identity: AnalyticsIdentity | null) => void = () => {}
    settled.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    report(appError('before settle'), 'window', false)
    change()
    settle(CONSENTED)
    await drain()
    const [event] = sentEvents()
    expect(event?.distinct_id).not.toBe('user-a')
    expect(event?.properties.$process_person_profile).toBe(false)
    expect(event?.properties).not.toHaveProperty('$session_id')
    expect(event?.properties).not.toHaveProperty('$groups')
  })

  it('scrubs the URL path and keeps an allowlisted query', async () => {
    window.history.replaceState(null, '', '/users/jane%40example.com?tab=overview&x=1')
    report(appError('boom'), 'window', false)
    await drain()
    const [event] = sentEvents()
    expect(event?.properties.$current_url).toBe(`${location.origin}/users/[email]?tab=overview`)
  })

  it('sends an error handed over more than ten seconds after it was noted anonymous, stamped when it was noted', async () => {
    setErrorRouteSource(() => '/_app/dashboard')
    window.history.replaceState(null, '', '/dashboard')
    const notedAt = Date.now() - STALE_ERROR_MS - 1
    report(appError('replayed'), 'window', false, notedAt)
    await drain()
    const [event] = sentEvents()
    expect(event?.timestamp).toBe(new Date(notedAt).toISOString())
    expect(event?.properties.$process_person_profile).toBe(false)
    expect(event?.properties).not.toHaveProperty('$groups')
    expect(event?.properties).not.toHaveProperty('route_id')
    expect(event?.properties).not.toHaveProperty('$current_url')
  })

  it('sends nothing without a key or in consent mode off', async () => {
    config.isAvailable = false
    report(appError('inert'), 'window', false)
    await drain()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a chunk-load error with no frames of its own, as handled, origin chunk_load', async () => {
    const error = new TypeError(
      `Failed to fetch dynamically imported module: ${location.origin}/assets/profile-abc.js`
    )
    error.stack = error.message
    report(error, 'react', false)
    await drain()
    const [event] = sentEvents()
    expect(event?.properties.origin).toBe('chunk_load')
    const [exception] = event?.properties.$exception_list as { mechanism: { handled: boolean } }[]
    expect(exception?.mechanism.handled).toBe(true)
  })

  it('drops an exception with no frame from this app', async () => {
    const error = new Error('from an extension')
    error.stack =
      'Error: from an extension\n    at inject (chrome-extension://abcdef/content.js:1:1)'
    report(error, 'window', false)
    report('a thrown string has no frames', 'rejection', false)
    await drain()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('scrubs the value and the frames before anything leaves', async () => {
    const error = appError('No account for ada@example.com')
    error.stack = `TypeError: No account for ada@example.com\n    at load (${location.origin}/assets/index-abc.js?token=leak:1:2)`
    report(error, 'window', false)
    await drain()
    const body = bodyOf(fetchMock.mock.calls[0]?.[1])
    expect(body).not.toContain('ada@example.com')
    expect(body).not.toContain('token=leak')
    expect(body).toContain('[email]')
    expect(body).toContain('?[query]')
  })

  it('keeps at most five links of a cause chain', async () => {
    let error: Error = appError('root cause')
    for (let depth = 0; depth < CAUSE_DEPTH + 3; depth += 1) {
      const outer = appError(`wrapper ${String(depth)}`)
      outer.cause = error
      error = outer
    }
    report(error, 'window', false)
    await drain()
    expect(sentEvents()[0]?.properties.$exception_list).toHaveLength(CAUSE_DEPTH)
  })

  it('keeps at most five exceptions of a cyclic cause chain, and does not hang', async () => {
    const first = appError('cycle a')
    const second = appError('cycle b', 'other')
    const third = appError('cycle c', 'another')
    Object.defineProperty(first, 'cause', { value: second })
    Object.defineProperty(second, 'cause', { value: third })
    Object.defineProperty(third, 'cause', { value: first })
    report(first, 'window', false)
    await drain()
    const [event] = sentEvents()
    expect((event?.properties.$exception_list as unknown[]).length).toBeLessThanOrEqual(CAUSE_DEPTH)
  })

  it('throttles to five per fingerprint and thirty per page life', async () => {
    for (let index = 0; index < FINGERPRINT_LIMIT + 3; index += 1) {
      report(appError('same place'), 'window', false)
    }
    await drain()
    expect(sentEvents()).toHaveLength(FINGERPRINT_LIMIT)

    for (let index = 0; index < PAGE_LIMIT + 5; index += 1) {
      report(appError('different place', `fn${String(index)}`), 'window', false)
    }
    await drain()
    await drain()
    expect(sentEvents()).toHaveLength(PAGE_LIMIT)
  })

  it('batches up to ten events per request', async () => {
    for (let index = 0; index < BATCH_SIZE + 1; index += 1) {
      report(appError('batched', `fn${String(index)}`), 'window', false)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentEvents()).toHaveLength(BATCH_SIZE)
    await drain()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a network failure or a 5xx once, after five seconds, then drops the batch', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    report(appError('retried'), 'window', false)
    await drain()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }))
    report(appError('refused'), 'window', false)
    await drain()
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends what is unsent, and what waits to retry, by a JSON beacon on pagehide', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    report(appError('waits to retry'), 'window', false)
    await drain()
    report(appError('still queued', 'other'), 'window', false)
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('pagehide'))

    expect(beacon).toHaveBeenCalledTimes(1)
    const [url, blob] = beacon.mock.calls[0] ?? []
    expect(url).toBe(`${location.origin}/api/v1/collect/batch/`)
    expect(blob?.type).toBe('application/json')
    const body = JSON.parse(await (blob as Blob).text()) as { batch: ExceptionEvent[] }
    expect(body.batch).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + BATCH_WINDOW_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a blocked collect once and raises no window error of its own', async () => {
    const raised = vi.fn()
    window.addEventListener('error', raised)
    try {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      report(appError('blocked collect'), 'window', false)
      await drain()
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(raised).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('error', raised)
    }
  })

  it.each([
    [
      'throws',
      () =>
        Object.defineProperty(navigator, 'sendBeacon', {
          value: () => {
            throw new Error('beacon blocked')
          },
          configurable: true,
        }),
    ],
    [
      'is missing',
      () =>
        Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true }),
    ],
  ])('raises no window error when sendBeacon %s on pagehide', async (_label, break_) => {
    const raised = vi.fn()
    window.addEventListener('error', raised)
    try {
      report(appError('queued'), 'window', false)
      await vi.advanceTimersByTimeAsync(0)
      break_()
      window.dispatchEvent(new Event('pagehide'))
      expect(raised).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('error', raised)
    }
  })

  it('splits a burst of deep exceptions into requests of at most 60 KiB, keepalive while the quota allows', async () => {
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      report(deepError(index), 'window', false)
    }
    await vi.advanceTimersByTimeAsync(0)
    await drain()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2)
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true)
    let keepaliveBytes = 0
    for (const [, init] of fetchMock.mock.calls) {
      const body = bodyOf(init)
      const bytes = new TextEncoder().encode(body).length
      expect(bytes).toBeLessThanOrEqual(BATCH_MAX_BYTES)
      if (init?.keepalive === true) keepaliveBytes += bytes
      expect((JSON.parse(body) as { batch: unknown[] }).batch.length).toBeLessThanOrEqual(
        BATCH_SIZE
      )
    }
    // Every chunk leaves in one flush, so all are in flight together.
    expect(keepaliveBytes).toBeLessThanOrEqual(KEEPALIVE_QUOTA_BYTES)
    expect(sentEvents()).toHaveLength(BATCH_SIZE)
  })

  it('beacons in chunks of at most 60 KiB on pagehide', async () => {
    for (let index = 0; index < BATCH_SIZE - 1; index += 1) {
      report(deepError(index), 'window', false)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon.mock.calls.length).toBeGreaterThan(2)
    for (const [, blob] of beacon.mock.calls) expect(blob.size).toBeLessThanOrEqual(BATCH_MAX_BYTES)
  })

  it('never throws, whatever it is handed', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile')
        },
      }
    )
    expect(() => {
      report(hostile, 'window', false)
    }).not.toThrow()
  })
})

describe('waiting for analytics to settle', () => {
  it('parks no new settle waiter per error once the settle cap has passed and analytics never settled', async () => {
    const actual = await vi.importActual<typeof import('@/observability/analytics')>(
      '@/observability/analytics'
    )
    // The real whenAnalyticsSettled, with analytics never loaded: each call while unsettled parks a waiter in its module Set, cleared only when analytics settles.
    let parked = 0
    settled.mockImplementation(() => {
      parked += 1
      return actual.whenAnalyticsSettled()
    })
    report(appError('first', 'a', 1), 'window', false)
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS + BATCH_WINDOW_MS)
    const before = parked
    for (let index = 0; index < 20; index += 1) {
      report(appError(`later ${String(index)}`, `f${String(index)}`, index + 2), 'window', false)
    }
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS)
    expect(sentEvents()).toHaveLength(21)
    expect(parked - before).toBe(0)
  })

  it('reads the identity again once analytics settles after the cap', async () => {
    let settle: (identity: AnalyticsIdentity | null) => void = () => {}
    const late = new Promise<AnalyticsIdentity | null>((resolve) => (settle = resolve))
    settled.mockReturnValue(late)
    report(appError('before the cap', 'a', 1), 'window', false)
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS + BATCH_WINDOW_MS)
    expect(sentEvents()[0]?.distinct_id).not.toBe('user-a')
    settle(CONSENTED)
    settled.mockResolvedValue(CONSENTED)
    await vi.advanceTimersByTimeAsync(0)
    report(appError('after the settle', 'b', 2), 'window', false)
    await drain()
    expect(sentEvents()[1]?.distinct_id).toBe('user-a')
  })

  it('beacons an error that is still waiting for analytics to settle when the page goes away', async () => {
    settled.mockReturnValue(new Promise(() => {})) // analytics has not settled yet
    report(appError('crash during load'), 'window', false)
    await vi.advanceTimersByTimeAsync(100)
    dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledTimes(1)
    const body = JSON.parse(await (beacon.mock.calls[0]?.[1] as Blob).text()) as {
      batch: ExceptionEvent[]
    }
    expect(body.batch).toHaveLength(1)
    expect(body.batch[0]?.properties.$process_person_profile).toBe(false)
  })

  it('does not send a beaconed error a second time when analytics settles later', async () => {
    let settle: (identity: AnalyticsIdentity | null) => void = () => {}
    settled.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    report(appError('crash during load'), 'window', false)
    await vi.advanceTimersByTimeAsync(100)
    dispatchEvent(new Event('pagehide'))
    settle(CONSENTED)
    await drain()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('keepalive bodies in flight', () => {
  it('never has more than 64 KiB of keepalive bodies in flight at once', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})) // in flight until the page ends
    for (let index = 0; index < 20; index += 1) report(deepError(index), 'window', false)
    await drain()
    const inFlight = fetchMock.mock.calls
      .filter(([, init]) => init?.keepalive === true)
      .reduce((sum, [, init]) => sum + new TextEncoder().encode(bodyOf(init)).length, 0)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(inFlight).toBeLessThanOrEqual(KEEPALIVE_QUOTA_BYTES)
  })

  it('a deep error beside a pending keepalive goes plain, and keepalive again once that settles', async () => {
    let finish: (response: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    for (const index of [0, 1, 2]) report(deepError(index), 'window', false)
    await drain()
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true)
    for (const index of [3, 4]) report(deepError(index), 'window', false)
    await drain()
    expect(fetchMock.mock.calls.at(-1)?.[1]?.keepalive).toBeUndefined()
    finish(new Response('{}', { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    for (const index of [5, 6]) report(deepError(index), 'window', false)
    await drain()
    expect(fetchMock.mock.calls.at(-1)?.[1]?.keepalive).toBe(true)
  })

  it('a keepalive request that fails on the network gives its bytes back', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    for (const index of [0, 1, 2]) report(deepError(index), 'window', false)
    await drain()
    for (const index of [3, 4, 5]) report(deepError(index), 'window', false)
    await drain()
    expect(fetchMock.mock.calls[1]?.[1]?.keepalive).toBe(true)
  })
})

describe('the identity across a navigation inside the same tenant', () => {
  it('keeps the consented identity: re-grouping the same tenant changes nothing', async () => {
    setTenantGroup('tenant-1')
    report(appError('crash on the members page'), 'react', true)
    setTenantGroup('tenant-1') // the router re-applies the same tenant on the next page
    await drain()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [event] = (
      JSON.parse(bodyOf(fetchMock.mock.calls[0]?.[1])) as { batch: ExceptionEvent[] }
    ).batch
    expect(event?.distinct_id).toBe('user-a')
  })
})

describe('isIgnoredError', () => {
  const response = (status: number) => ({
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  })

  it.each([
    ['an API error', new AxiosError('500', 'ERR_BAD_RESPONSE', undefined, {}, response(500))],
    ['a network failure through axios', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['an axios cancel', new CanceledError()],
    ['an abort', new DOMException('The user aborted a request.', 'AbortError')],
    ['a fetch network failure', new TypeError('Failed to fetch')],
    [
      'a Firefox fetch network failure',
      new TypeError('NetworkError when attempting to fetch resource.'),
    ],
    [
      'ResizeObserver noise',
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
      }),
    ],
    [
      'the old ResizeObserver message',
      new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }),
    ],
    ['an opaque cross-origin script error', new ErrorEvent('error', { message: 'Script error.' })],
  ])('drops %s', (_label, input) => {
    expect(isIgnoredError(input)).toBe(true)
  })

  it.each([
    ['a render crash', appError('x is undefined')],
    ['a thrown string', 'boom'],
    ['a number', 42],
    ['an object without a message', { code: 1 }],
  ])('keeps %s', (_label, input) => {
    expect(isIgnoredError(input)).toBe(false)
  })
})

describe('isAppFrame', () => {
  it.each([
    [`${location.origin}/assets/index-abc.js`, true],
    [`${location.origin}/src/main.tsx`, true],
    [`${location.origin}/theme-init.js`, false],
    ['https://cdn.example.test/assets/lib.js', false],
    ['chrome-extension://abcdef/content.js', false],
    ['moz-extension://abcdef/content.js', false],
    ['safari-extension://abcdef/content.js', false],
    ['<anonymous>', false],
    [undefined, false],
  ])('%s is in-app: %s', (filename, expected) => {
    expect(isAppFrame(filename)).toBe(expected)
  })
})

describe('fingerprintOf', () => {
  it('uses the innermost in-app frame, or the value when there is none', () => {
    const frames = [
      {
        platform: 'web:javascript' as const,
        filename: 'a.js',
        function: 'outer',
        lineno: 9,
        in_app: true,
      },
      {
        platform: 'web:javascript' as const,
        filename: 'b.js',
        function: 'inner',
        lineno: 1,
        in_app: true,
      },
      {
        platform: 'web:javascript' as const,
        filename: 'ext.js',
        function: 'x',
        lineno: 3,
        in_app: false,
      },
    ]
    expect(
      fingerprintOf([{ type: 'TypeError', value: 'v', stacktrace: { type: 'raw', frames } }])
    ).toBe('TypeError|b.js:inner:1')
    expect(fingerprintOf([{ type: 'Error', value: 'no frames' }])).toBe('Error|no frames')
  })
})
