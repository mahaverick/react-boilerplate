import { describe, expect, it } from 'vitest'
import { parseSseStream, type SseEvent } from '@/http/sse'

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
    // The case a naive split-per-chunk parser gets wrong, and the reason the
    // buffer survives across reads.
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

  it('parses a CRLF-terminated frame, not just LF', async () => {
    // Nothing in this stack emits CRLF today, but it is legal SSE, and a
    // `\n\n` split against a `\r\n\r\n` stream matches nothing at all: the
    // buffer would grow forever and every frame would be silently dropped
    // when the stream ends. No partial delivery, no error — just a
    // connection that looks alive and never delivers.
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

  it('throws once a frame with no blank line grows past the buffer cap, rather than growing forever', async () => {
    // No `\n\n` anywhere in this stream — exactly a server that never closes
    // a frame. Without a cap, `buffer` would grow for as long as the stream
    // stays open; native `EventSource` parsed line-by-line and had no such
    // failure mode at all.
    const chunk = `data: ${'x'.repeat(64 * 1024)}\n`
    const runaway = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        // 17 * 64KiB > 1 MiB, still well under it after 16.
        for (let i = 0; i < 17; i += 1) controller.enqueue(encoder.encode(chunk))
        // Deliberately never closed and never sends a blank line — closing it
        // would let the generator return normally before the cap is ever
        // reached, which is not the case this test exists to cover.
      },
    })

    const events: SseEvent[] = []
    await expect(async () => {
      for await (const event of parseSseStream(runaway)) events.push(event)
    }).rejects.toThrow(/buffer exceeded/i)
    expect(events).toHaveLength(0)
  })

  it('delivers a burst of complete frames larger than the cap instead of mistaking it for a runaway', async () => {
    // The cap measures what is RETAINED after framing, not what arrived. A
    // single chunk carrying more than a megabyte of perfectly complete
    // frames is a big burst, not a frame that never ends — checking the
    // pre-split buffer would throw here, blame "no complete frame", and
    // discard every one of them.
    const frame = `data: ${'y'.repeat(16 * 1024)}\n\n`
    const burst = frame.repeat(80) // ~1.3 MiB, all of it complete frames
    const events: SseEvent[] = []

    for await (const event of parseSseStream(streamOf(burst))) events.push(event)

    expect(events).toHaveLength(80)
    expect(events[0]?.data).toHaveLength(16 * 1024)
  })
})
