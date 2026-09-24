import { vi } from 'vitest'
import type { ApiErrorBody } from '@/types/api.types'

/**
 * A refused CONNECT — the response `fetch()` resolves to when the server
 * declines the connection outright (a 401, a 500), as opposed to `fail()`
 * below, which fails a stream already open. `body`, when given, matches this
 * codebase's `ApiErrorBody` envelope, exactly as `errorHandler`
 * (express-boilerplate's error.middleware.ts) actually serializes a
 * rejection.
 */
export interface ConnectRefusal {
  status: number
  body?: ApiErrorBody
}

let queuedConnectRefusal: ConnectRefusal | null = null

/**
 * Make the NEXT `MockFetchStream` constructed answer its `fetch()` caller
 * with a non-ok response instead of the ordinary streaming 200 — the connect
 * itself refused, exactly as `!response.ok` looks to
 * `useNotificationStream`. Consumed once: it affects only the very next
 * connect, never a later reconnect.
 * @param refusal - The status (and, optionally, JSON body) the refused connect resolves with.
 */
export function queueConnectRefusal(refusal: ConnectRefusal): void {
  queuedConnectRefusal = refusal
}

/**
 * Enough of a `fetch` streaming response to drive `useNotificationStream`
 * over its fetch transport, and no more.
 *
 * Modeled on the `MockEventSource` this replaced: one instance per
 * `connect()` call, captured
 * on `instances` so a test can inspect what was actually sent (the URL, the
 * `Authorization` and `Last-Event-ID` headers) and control what comes back —
 * a frame, a clean end, a mid-stream failure, or (via `queueConnectRefusal`)
 * a non-ok CONNECT response — without a real network call or a real server.
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

    // Consumed once: only the very next connect is refused. Every later
    // reconnect — including the one this same failure schedules — gets the
    // ordinary streaming 200 below, unless the test queues another refusal.
    const refusal = queuedConnectRefusal
    queuedConnectRefusal = null
    if (refusal) {
      this.response = new Response(
        refusal.body === undefined ? null : JSON.stringify(refusal.body),
        {
          status: refusal.status,
          headers: refusal.body === undefined ? {} : { 'Content-Type': 'application/json' },
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

  /** Send one complete SSE frame, exactly as the server would — the trailing blank line is added here. */
  dispatch(event: { id?: string; event?: string; data: string }): void {
    const lines = [
      event.id === undefined ? null : `id: ${event.id}`,
      event.event === undefined ? null : `event: ${event.event}`,
      `data: ${event.data}`,
    ].filter((line): line is string => line !== null)
    this.push(`${lines.join('\n')}\n\n`)
  }

  /** Push a raw, unformatted chunk — for the rare test that cares about framing itself. */
  push(chunk: string): void {
    this.controller?.enqueue(this.encoder.encode(chunk))
  }

  /**
   * End the stream the way the server closing the connection would: the
   * hook's `for await` loop exits normally, and it reconnects.
   */
  end(): void {
    this.controller?.close()
  }

  /**
   * Fail the stream: the pending `read()` inside `parseSseStream` rejects,
   * which the hook's `for await` loop surfaces as a thrown error, caught by
   * its own `catch` and turned into the same reconnect.
   */
  fail(error: unknown = new Error('stream error')): void {
    this.controller?.error(error)
  }
}

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
 * Install a `fetch` stub that answers only `matchUrl` — the notification
 * stream endpoint — with a `MockFetchStream`. Nothing else in these tests
 * calls `fetch` directly: `apiClient` is axios, which resolves to the XHR
 * adapter under jsdom and is intercepted by msw independently of this stub.
 * A call to any other URL is therefore a bug in the test, not a real request
 * to let through, so it throws rather than falling back to a real network
 * call — which surfaces here as the hook's own `catch` swallowing the throw
 * and every `MockFetchStream.instances` assertion in the test failing
 * because nothing was ever recorded, not as the throw itself reaching the
 * test's own stack.
 */
export function stubStreamFetch(matchUrl: string): void {
  // Reset here, not left to bleed from a previous test: this is the one
  // function every test in this suite already calls from `beforeEach`.
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
