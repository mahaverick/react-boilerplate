/**
 * @file A stand-in for PostHog's ingest and assets hosts, for the e2e suites
 * that need analytics to really run. It serves posthog-js's own `dist/` as
 * the assets host, so the replay recorder and lazy extensions load exactly as
 * in production, answers the remote config with replay switched on, and
 * records every request body fully decoded: the transport's gzip or base64
 * layer, and the gzip strings replay nests inside its snapshot events. A
 * search of `bodies()` is therefore a search of everything that left the
 * browser (and express's own `/batch/` drain), as PostHog would receive it.
 */
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { expect, type Locator, type Page } from '@playwright/test'

/** posthog-js's build output, served for `/static/*`. */
const POSTHOG_DIST = path.resolve(import.meta.dirname, '../../node_modules/posthog-js/dist')

/** The remote config: replay on, with posthog-js's own snapshot endpoint. */
const REMOTE_CONFIG = {
  sessionRecording: { endpoint: '/s/' },
  supportedCompression: ['gzip-js'],
  autocapture_opt_out: false,
  capturePerformance: false,
  heatmaps: false,
  surveys: false,
  siteApps: [],
}

/** The ingest paths posthog-js posts to, and express's drain (`/batch/`). */
const INGEST_PATHS = ['/e/', '/i/v0/e/', '/s/', '/batch/', '/flags/', '/decide/']

/**
 * The fixed port a live suite starts the fake on, which express's
 * `POSTHOG_HOST` and `POSTHOG_ASSETS_HOST` must name before the suite starts.
 * Express itself defaults to :4040 and the live e2e express to :4050.
 */
export const FAKE_POSTHOG_PORT = Number(process.env.E2E_FAKE_POSTHOG_PORT ?? 4063)

/**
 * How long to wait for a replay upload after an interaction: posthog-js
 * 1.435.6 flushes its replay buffer on a 2 s timer and then sends it through
 * its request queue, so the upload lands seconds after the click.
 */
export const REPLAY_UPLOAD_TIMEOUT_MS = 15_000

/** One request as the fake received it, its body decoded to text. */
export interface FakePosthogRequest {
  method: string
  /** The path, without the query string. */
  path: string
  /** Request headers, lowercased, as Node received them. */
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** One event the fake received, from the browser (`/e/`, `/i/v0/e/`) or express (`/batch/`). */
export interface FakePosthogEvent {
  /** The path it arrived on: `/batch/` is express's drain, the rest are the browser's. */
  path: string
  event: string
  /** The browser sends it in `properties`, express beside them. */
  distinctId: string | undefined
  properties: Record<string, unknown>
}

/** A running fake. */
export interface FakePosthog {
  /** `http://127.0.0.1:<port>`, for `POSTHOG_HOST` and `POSTHOG_ASSETS_HOST`. */
  url: string
  /** Every request so far, in arrival order. */
  requests: FakePosthogRequest[]
  /** Every decoded body so far, joined: the haystack for a PII search. */
  bodies: () => string
  /** The decoded bodies of requests to `pathname` (`/s/` for replay). */
  bodiesFor: (pathname: string) => string[]
  /** Every event received on an event path, browser and server alike, in order. */
  events: () => FakePosthogEvent[]
  close: () => Promise<void>
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** Replay gzips snapshot fields and stores the bytes as a latin1 string; expands those in place. */
function expandNested(value: unknown): unknown {
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'latin1')
    if (!isGzip(bytes)) return value
    let inner: string
    try {
      inner = gunzipSync(bytes).toString('utf8')
    } catch {
      return value
    }
    try {
      return expandNested(JSON.parse(inner))
    } catch {
      return inner
    }
  }
  if (Array.isArray(value)) return value.map(expandNested)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        expandNested(entry),
      ])
    )
  }
  return value
}

/**
 * The transport layer undone (gzip, a `data=` base64 form or plain), then
 * every nested gzip string expanded.
 * @param raw - The request body as received.
 * @returns The body as text.
 */
export function decodeBody(raw: Buffer): string {
  let text: string
  if (isGzip(raw)) {
    text = gunzipSync(raw).toString('utf8')
  } else {
    text = raw.toString('utf8')
    if (text.startsWith('data=')) {
      const data = new URLSearchParams(text).get('data') ?? ''
      text = Buffer.from(data, 'base64').toString('utf8')
    }
  }
  try {
    return JSON.stringify(expandNested(JSON.parse(text)))
  } catch {
    return text
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
  response.end(body)
}

function remoteConfigScript(token: string): string {
  const config = JSON.stringify({ token, config: REMOTE_CONFIG, siteApps: [] })
  return `(function(){window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}]=${config}})();`
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  // posthog-js asks for `/static/<version>/<file>` first; the dist has one flat directory.
  const name = pathname.replace(/^\/static\/(?:\d+\.\d+\.\d+\/)?/, '')
  const file = path.normalize(path.join(POSTHOG_DIST, name))
  if (!file.startsWith(`${POSTHOG_DIST}${path.sep}`)) {
    send(response, 404, 'text/plain', 'not found')
    return
  }
  try {
    send(response, 200, 'application/javascript', await readFile(file))
  } catch {
    send(response, 404, 'text/plain', 'not found')
  }
}

/** The events in one decoded body: a JSON array, `{ batch }` (express) or `{ data }`, or one event. */
function eventsIn(request: FakePosthogRequest): FakePosthogEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(request.body)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { batch?: unknown[]; data?: unknown[] }).batch ??
      (parsed as { data?: unknown[] }).data ?? [parsed])
  return (list as Record<string, unknown>[]).map((raw) => {
    const properties = (raw.properties ?? {}) as Record<string, unknown>
    return {
      path: request.path,
      event: String(raw.event),
      distinctId: (raw.distinct_id ?? properties.distinct_id) as string | undefined,
      properties,
    }
  })
}

/**
 * Starts the fake on 127.0.0.1.
 * @param port - A fixed port, when the API under test must be told the URL before the test starts; 0 picks a free one.
 * @returns The running fake.
 */
export async function startFakePosthog(port = 0): Promise<FakePosthog> {
  const requests: FakePosthogRequest[] = []

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fake-posthog.invalid')
      const pathname = url.pathname
      const raw = await readBody(request)
      requests.push({
        method: request.method ?? 'GET',
        path: pathname,
        headers: request.headers,
        body: decodeBody(raw),
      })

      const configMatch = /^\/array\/([^/]+)\/config(\.js)?$/.exec(pathname)
      if (configMatch) {
        const token = decodeURIComponent(configMatch[1] ?? '')
        if (configMatch[2]) {
          send(response, 200, 'application/javascript', remoteConfigScript(token))
        } else {
          send(response, 200, 'application/json', JSON.stringify(REMOTE_CONFIG))
        }
        return
      }
      if (pathname.startsWith('/static/')) {
        await serveStatic(pathname, response)
        return
      }
      if (pathname === '/flags/' || pathname === '/decide/') {
        send(
          response,
          200,
          'application/json',
          JSON.stringify({
            ...REMOTE_CONFIG,
            flags: {},
            featureFlags: {},
            errorsWhileComputingFlags: false,
          })
        )
        return
      }
      if (INGEST_PATHS.includes(pathname)) {
        send(response, 200, 'application/json', JSON.stringify({ status: 1 }))
        return
      }
      send(response, 404, 'text/plain', 'not found')
    })()
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const { port: bound } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${bound}`,
    requests,
    bodies: () => requests.map((entry) => entry.body).join('\n'),
    bodiesFor: (pathname) =>
      requests.filter((entry) => entry.path === pathname).map((entry) => entry.body),
    events: () =>
      requests
        .filter((entry) => ['/e/', '/i/v0/e/', '/batch/'].includes(entry.path))
        .flatMap(eventsIn),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/**
 * Answers every `/api/v1/collect/*` request `page` makes from `fake`, with the
 * prefix stripped as express's proxy strips it: for a test with nothing
 * behind `/api`. Only the browser's traffic reaches the fake this way.
 * @param page - The page under test.
 * @param fake - A running fake.
 */
export async function routeCollectToFake(page: Page, fake: FakePosthog): Promise<void> {
  await page.route('**/api/v1/collect/**', async (route) => {
    const url = new URL(route.request().url())
    const target = `${fake.url}${url.pathname.replace('/api/v1/collect', '')}${url.search}`
    try {
      await route.fulfill({ response: await route.fetch({ url: target }) })
    } catch {
      // The page navigated or closed while this request was in flight: nothing waits for it.
    }
  })
}

/**
 * A desktop Chrome user agent with no "Headless" in it, for `test.use({ userAgent })`.
 * posthog-js drops every event from a user agent on its bot list.
 */
export const HUMAN_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/**
 * Makes `page` pass posthog-js's bot filter, which also drops every event
 * while `navigator.webdriver` is true, as it always is under Playwright, or
 * while a `userAgentData` brand says `HeadlessChrome`. Call it before the
 * first navigation; pair it with `HUMAN_USER_AGENT`.
 * @param page - The page under test.
 */
export async function passPosthogBotFilter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined })
  })
}

/**
 * Clicks `target` until a replay upload whose decoded body contains `text`
 * has reached `fake`. posthog-js records only once its lazily loaded recorder
 * has started, and holds back the replay of a page nobody has touched since,
 * so a single click made before the recorder arrived can leave nothing to send.
 * @param fake - The fake the page's `/api/v1/collect` traffic reaches.
 * @param target - Something harmless to click, such as the page's heading.
 * @param text - What the upload must contain: page text, or the page's path (its replay `href`).
 */
export async function clickUntilReplayed(
  fake: FakePosthog,
  target: Locator,
  text: string
): Promise<void> {
  await expect(async () => {
    await target.click()
    expect(fake.bodiesFor('/s/').some((body) => body.includes(text))).toBe(true)
  }).toPass({ intervals: [1_000], timeout: 2 * REPLAY_UPLOAD_TIMEOUT_MS })
}
