/** One parsed SSE frame. */
export interface SseEvent {
  id?: string
  event?: string
  data: string
}

// A frame that never completes — no blank line ever arrives — would
// otherwise grow `buffer` forever. `EventSource` parsed line-by-line and had
// no such property; this replacement does, because it has to buffer until it
// sees a frame boundary. ~1 MiB is far past any real notification payload
// (see `NotificationStreamPayload`, notification-stream.controller.ts) and
// small enough that hitting it costs nothing worse than one reconnect.
const MAX_BUFFER_LENGTH = 1024 * 1024

/**
 * Parse SSE frames out of a `fetch` response body.
 *
 * Ported from Consequential's `pulse/src/http/sse.http.ts`, which exists for
 * the same reason this does: `EventSource` cannot send an `Authorization`
 * header, so the stream is read from `fetch` instead — and then something
 * has to do the framing `EventSource` was doing for us.
 *
 * The buffer OUTLIVES each read deliberately. A frame is not guaranteed to
 * arrive whole in one chunk, and splitting per chunk drops the boundary case
 * silently.
 *
 * Frame and line separators both tolerate a `\r` before the `\n`. Nothing in
 * this stack emits CRLF today — `notification-stream.controller.ts` writes
 * literal `\n` at every call site, and nginx passes body bytes through
 * unmodified — but CRLF is legal SSE, and the failure mode if this tolerance
 * were dropped would be silent for a while: a CRLF frame would sit in
 * `buffer` unmatched by a bare `\n\n` split, until `MAX_BUFFER_LENGTH` below
 * eventually throws. A regex here is cheaper than that risk.
 *
 * `MAX_BUFFER_LENGTH` covers the OTHER way a frame can fail to complete: a
 * server that never sends the blank line at all. Exceeding it throws, which
 * lands in the caller's `catch` (`useNotificationStream`) and reconnects —
 * this function does not handle that case itself, only refuses to run away
 * on it.
 * @param body - The response body stream.
 * @yields Each complete frame, in order.
 * @throws {Error} When `buffer` exceeds `MAX_BUFFER_LENGTH` without ever completing a frame.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_BUFFER_LENGTH) {
        throw new Error(
          `SSE buffer exceeded ${String(MAX_BUFFER_LENGTH)} bytes without a complete frame`
        )
      }

      const frames = buffer.split(/\r?\n\r?\n/)
      // The last element is an incomplete frame, or ''. Keep it for next read.
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
      }
    }
  } finally {
    // Harmless today — the sole consumer's `for await` never `break`s early
    // — but this is permanent infrastructure with one job, and a future
    // consumer that does break early would otherwise leak the lock.
    reader.releaseLock()
  }
}

/**
 * Turn one raw frame into an event, or nothing.
 * @param frame - The frame text, without its trailing blank line.
 * @returns The event, or undefined for a comment or a frame with no data.
 */
function parseFrame(frame: string): SseEvent | undefined {
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []

  for (const line of frame.split(/\r?\n/)) {
    // A comment. The server's heartbeat is `:ping`, and it must not surface
    // as an event — it exists to keep proxies from reaping an idle socket.
    if (line.startsWith(':')) continue
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }

  if (data.length === 0) return undefined
  return { id, event, data: data.join('\n') }
}
