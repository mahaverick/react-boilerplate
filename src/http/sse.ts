/** One parsed SSE frame. */
export interface SseEvent {
  id?: string
  event?: string
  data: string
}

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
 * unmodified — but CRLF is legal SSE, and the failure mode if it ever showed
 * up would be total and silent: `\n\n` never matches `\r\n\r\n`, the buffer
 * grows without bound, and every frame is discarded unparsed when the stream
 * ends. A regex here is cheaper than that risk.
 * @param body - The response body stream.
 * @yields Each complete frame, in order.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split(/\r?\n\r?\n/)
    // The last element is an incomplete frame, or ''. Keep it for next read.
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const parsed = parseFrame(frame)
      if (parsed) yield parsed
    }
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
    // A comment. The server's heartbeat is `: ping`, and it must not surface
    // as an event — it exists to keep proxies from reaping an idle socket.
    if (line.startsWith(':')) continue
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }

  if (data.length === 0) return undefined
  return { id, event, data: data.join('\n') }
}
