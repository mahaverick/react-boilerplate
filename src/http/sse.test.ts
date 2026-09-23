import { describe, expect, it } from 'vitest'
import { parseSseStream } from '@/http/sse'

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
})
