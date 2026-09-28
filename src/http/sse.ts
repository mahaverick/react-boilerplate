/** One parsed SSE frame. */
export interface SseEvent {
  id?: string
  event?: string
  data: string
}

/**
 * The most a never-completing frame may buffer before the parser throws. Far
 * past any real notification payload, and small enough that hitting it costs
 * one reconnect.
 */
const MAX_BUFFER_LENGTH = 1024 * 1024

/**
 * Parse SSE frames out of a `fetch` response body. The stream is read with
 * `fetch` because `EventSource` cannot send an `Authorization` header, so this
 * does the framing `EventSource` would.
 *
 * The buffer outlives each read, because a frame may arrive split across
 * chunks. Separators tolerate a `\r` before the `\n`: CRLF is legal SSE, and
 * a CRLF frame would otherwise sit unmatched until the buffer limit throws.
 * The limit is checked after the split and after yielding, against the
 * retained tail only, so a large burst of complete frames is delivered rather
 * than tripping it. The throw lands in the caller's `catch`
 * (`useNotificationStream`), which reconnects.
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

      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
      }

      if (buffer.length > MAX_BUFFER_LENGTH) {
        throw new Error(
          `SSE buffer exceeded ${String(MAX_BUFFER_LENGTH)} bytes without a complete frame`
        )
      }
    }
  } finally {
    // Releases the reader's lock when a consumer breaks out of `for await` early.
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
    if (line.startsWith(':')) continue
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }

  if (data.length === 0) return undefined
  return { id, event, data: data.join('\n') }
}
