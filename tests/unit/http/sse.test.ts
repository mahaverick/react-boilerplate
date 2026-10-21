import { describe, expect, it } from 'vite-plus/test'
import { parseSseStream, type SseEvent } from '@/http/sse'

/** A stream that delivers each chunk as its own read, then closes. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('parseSseStream', () => {
  it('yields one event per frame', async () => {
    const events = []
    for await (const event of parseSseStream(streamOf('data: one\n\ndata: two\n\n'))) {
      events.push(event)
    }
    expect(events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('reassembles a frame split across chunks', async () => {
    // A parser that splits each chunk on its own gets this wrong; it is why the buffer survives across reads.
    const events = []
    for await (const event of parseSseStream(streamOf('data: sp', 'lit\n\n'))) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('split')
  })

  it('carries id and event name, which is what makes replay work', async () => {
    const events = []
    for await (const event of parseSseStream(
      streamOf('id: 42\nevent: notification\ndata: x\n\n')
    )) {
      events.push(event)
    }
    expect(events[0]).toMatchObject({ id: '42', event: 'notification', data: 'x' })
  })

  it('skips a heartbeat comment without yielding an event', async () => {
    const events = []
    for await (const event of parseSseStream(streamOf(': ping\n\ndata: real\n\n'))) {
      events.push(event)
    }
    expect(events.map((e) => e.data)).toEqual(['real'])
  })

  /**
   * Nothing in this stack emits CRLF, but it is legal SSE, and a `\n\n` split matches
   * nothing in a `\r\n\r\n` stream: no frame is delivered and no error is raised, on a
   * connection that looks alive, until the buffer cap throws.
   */
  it('parses a CRLF-terminated frame, not just LF', async () => {
    const events = []
    for await (const event of parseSseStream(streamOf('data: crlf\r\n\r\n'))) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('crlf')
  })

  it('tolerates mixed CRLF and LF endings, within and between frames', async () => {
    const events = []
    for await (const event of parseSseStream(
      streamOf('id: 1\r\nevent: notification\r\ndata: mixed\r\n\r\ndata: two\n\n')
    )) {
      events.push(event)
    }
    expect(events).toMatchObject([
      { id: '1', event: 'notification', data: 'mixed' },
      { data: 'two' },
    ])
  })

  /** No `\n\n` anywhere in this stream, as from a server that never closes a frame: without a cap, `buffer` would grow for as long as the stream stays open. */
  it('throws once a frame with no blank line grows past the buffer cap, rather than growing forever', async () => {
    const chunk = `data: ${'x'.repeat(64 * 1024)}\n`
    const runaway = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        // Each chunk is 64 KiB plus 7 characters, so the 16th already takes the buffer past the 1 MiB cap.
        for (let i = 0; i < 17; i += 1) controller.enqueue(encoder.encode(chunk))
        // Never closed and no blank line: closing it would let the generator return normally before the cap is reached.
      },
    })

    const events: SseEvent[] = []
    await expect(async () => {
      for await (const event of parseSseStream(runaway)) events.push(event)
    }).rejects.toThrow(/buffer exceeded/i)
    expect(events).toHaveLength(0)
  })

  /**
   * The cap measures what is retained after framing, not what arrived. A chunk of more than
   * a megabyte of complete frames is a burst, not a frame that never ends; checking the
   * pre-split buffer would throw here and discard every one of them.
   */
  it('delivers a burst of complete frames larger than the cap instead of mistaking it for a runaway', async () => {
    const frame = `data: ${'y'.repeat(16 * 1024)}\n\n`
    const burst = frame.repeat(80) // about 1.25 MiB, all complete frames
    const events: SseEvent[] = []

    for await (const event of parseSseStream(streamOf(burst))) events.push(event)

    expect(events).toHaveLength(80)
    expect(events[0]?.data).toHaveLength(16 * 1024)
  })
})
