import { vi } from 'vitest'
import type { ApiErrorBody } from '@/types/api.types'

/**
 * A refused connect: the response `fetch()` resolves to when the server declines the
 * connection outright (a 401, a 500), as opposed to `MockFetchStream.fail`, which fails a
 * stream already open. A given `body` uses the `ApiErrorBody` envelope, as express's
 * `errorHandler` (`error.middleware.ts`) serializes a rejection.
 */
export interface ConnectRefusal {
  status: number
  body?: ApiErrorBody
  /** Response headers beside the body's `Content-Type`, such as `Retry-After`. */
  headers?: Record<string, string>
}

let queuedConnectRefusal: ConnectRefusal | null = null

/**
 * Makes the next `MockFetchStream` answer its `fetch()` caller with a non-ok response
 * instead of the streaming 200. Consumed once: a later reconnect is not refused.
 * @param refusal - The status (and, optionally, JSON body) the refused connect resolves with.
 */
export function queueConnectRefusal(refusal: ConnectRefusal): void {
  queuedConnectRefusal = refusal
}

/**
 * Enough of a `fetch` streaming response to drive `useNotificationStream` without a
 * network. One instance per connect, kept on `instances` so a test can read what was sent
 * (the URL, the `Authorization` and `Last-Event-ID` headers) and control what comes back:
 * a frame, a clean end, a mid-stream failure or, via `queueConnectRefusal`, a refused connect.
 */
export class MockFetchStream {
  static instances: MockFetchStream[] = []
  readonly headers: Record<string, string>
  aborted = false
  /** The `Response` this instance's `fetch()` call resolves to. */
  readonly response: Response
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private readonly encoder = new TextEncoder()

  constructor(
    public readonly url: string,
    init: RequestInit
  ) {
    this.headers = headersToRecord(init.headers)
    init.signal?.addEventListener('abort', () => {
      this.aborted = true
    })

    // Consumed here, so the reconnect this refusal schedules gets the streaming 200 unless the test queues another.
    const refusal = queuedConnectRefusal
    queuedConnectRefusal = null
    if (refusal) {
      this.response = new Response(
        refusal.body === undefined ? null : JSON.stringify(refusal.body),
        {
          status: refusal.status,
          headers: {
            ...(refusal.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...refusal.headers,
          },
        }
      )
      MockFetchStream.instances.push(this)
      return
    }

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
    })
    this.response = new Response(body, { status: 200 })
    MockFetchStream.instances.push(this)
  }

  /** Sends one complete SSE frame, adding the trailing blank line that ends it. */
  dispatch(event: { id?: string; event?: string; data: string }): void {
    const lines = [
      event.id === undefined ? null : `id: ${event.id}`,
      event.event === undefined ? null : `event: ${event.event}`,
      `data: ${event.data}`,
    ].filter((line): line is string => line !== null)
    this.push(`${lines.join('\n')}\n\n`)
  }

  /** Pushes a raw chunk, for a test about framing itself. */
  push(chunk: string): void {
    this.controller?.enqueue(this.encoder.encode(chunk))
  }

  /** Ends the stream as a server closing the connection would: the hook's loop exits normally and it reconnects. */
  end(): void {
    this.controller?.close()
  }

  /** Fails the open stream: the pending read rejects, and the hook's `catch` schedules a reconnect. */
  fail(error: unknown = new Error('stream error')): void {
    this.controller?.error(error)
  }
}

/** Flattens any `HeadersInit` shape into a plain record, so a test can assert on a header by name. */
function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

/** The most recently constructed stream. */
export function latestFetchStream(): MockFetchStream {
  const instance = MockFetchStream.instances.at(-1)
  if (!instance) throw new Error('no fetch stream was opened')
  return instance
}

/**
 * Installs a `fetch` stub that answers only `matchUrl`, the notification stream endpoint,
 * with a `MockFetchStream`. `apiClient` is axios, which uses the XHR adapter under jsdom and
 * is intercepted by msw, so a direct `fetch` to any other URL is a test bug and throws. The
 * hook's own `catch` swallows that throw, so it shows up as `MockFetchStream.instances`
 * assertions failing because nothing was recorded.
 */
export function stubStreamFetch(matchUrl: string): void {
  // Reset here so a refusal queued by one test cannot reach the next; every stream test calls this from `beforeEach`.
  queuedConnectRefusal = null
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.includes(matchUrl)) {
        throw new Error(`unexpected fetch to ${url} — only ${matchUrl} is stubbed`)
      }
      return Promise.resolve(new MockFetchStream(url, init).response)
    })
  )
}
